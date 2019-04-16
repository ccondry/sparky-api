const uuidv1 = require('uuid/v1')
const egainLibrary = require('./egainLibrary.js')
const request = require('request-promise-native')
const egainEventHandlers = require('./egainEventHandlers')
const transcript = require('./transcript')
const axios = require('axios')
const util = require('util')
const uccxChatClient = require('uccx-chat-client')
const smEventHandlers = require('./smEventHandlers')
const localization = require('./models/localization')
const DB = require('./models/db')
const cumulusDb = new DB('cumulus')
const toolboxDb = new DB('toolbox')
const cache = require('./models/sessions')

class Session {
  // create a session object
  constructor (type, data, onAddMessage, onTypingStart, onTypingStop) {
    // copy data from input to this, or assign default values if properties are
    // not found
    if (data.id) {
      this.id = data.id
      // console.log(data.id, '- existing chat session data being instantiated as object.')
    } else {
      // new session - generate uuid
      this.id = uuidv1()
      console.log(this.id, '- new chat session started.')
    }
    this.state = data.state || 'active'
    // set timestamp
    this.timestamp = data.timestamp || new Date().getTime()
    // set createdAt for database record time-to-live
    // this.createdAt = data.createdAt || new Date()
    // set expireAt for database record time-to-live
    if (data.expireAt) {
      this.expireAt = data.expireAt
    } else {
      let d = new Date()
      d.setSeconds(d.getSeconds() + Number(process.env.SESSION_TIMEOUT))
      this.expireAt = d
    }

    this.inSurvey = data.inSurvey || false
    this.isEscalated = data.isEscalated || false
    this.messages = data.messages || []
    this.phone = data.phone
    this.email = data.email
    this.userId = data.userId
    this.firstName = data.firstName
    this.lastName = data.lastName

    // set language and country (region)
    this.language = data.language || process.env.DEFAULT_LANGUAGE || 'en'
    this.region = data.region || process.env.DEFAULT_REGION || 'US'

    // set language code
    this.languageCode = data.languageCode || `${this.language.toLowerCase()}-${this.region.toUpperCase()}`

    // run this callback when messages are added
    this.onAddMessage = onAddMessage

    // run this callback when agent starts typing
    this.onTypingStart = onTypingStart

    // run this callback when messages are added
    this.onTypingStop = onTypingStop

    // resolve this promise to get user data
    // this.getCustomerData = data.getCustomerData

    this.apiAiToken = data.apiAiToken || process.env.API_AI_TOKEN
    this.entryPointId = data.entryPointId || process.env.ENTRY_POINT_ID

    // dCloud session information
    this.dcloudSession = data.dcloudSession
    this.dcloudDatacenter = data.dcloudDatacenter

    if (data.botEnabled === false) {
      this.botEnabled = false
    } else {
      this.botEnabled = true
    }
    this.type = type
    this.data = data
    // enable survey by default
    if (typeof this.survey === 'undefined') {
      this.survey = true
    }
    // console.log(`creating ${this.type} Sparky session ${this.id}: for ${this.firstName} ${this.lastName} with AI token ${this.apiAiToken} for entry point ${this.entryPointId} and survey is ${this.survey ? 'enabled' : 'disabled'}`)
    // const logData = JSON.parse(JSON.stringify(this))

    // create survey answers array
    this.surveyAnswers = data.surveyAnswers || []

    // if we have dcloud session and datacenter info, check the session info now
    if (this.dcloudSession && this.dcloudDatacenter) {
      console.log(this.id, '- started checking for dCloud session info')
      this.checkSessionPromise = this.checkSessionInfo()
    } else {
      console.log(this.id, '- not checking for dCloud session info yet')
      console.log('this.dcloudSession =', this.dcloudSession, 'and this.dcloudDatacenter =', this.dcloudDatacenter)
    }

    // facebook session identifiers
    this.pageId = data.pageId
    this.senderId = data.senderId
    // facebook page token data
    this.page = data.page

    // twilio session identifiers
    this.to = data.to
    this.from = data.from
    this.app = data.app
  }

  async checkExpiration () {
    // did session expire?
    if (new Date().getTime() > this.expireAt) {
      // expired
      console.log(`${this.id} - session is old and has expired. Removing this session. expireAt =`, this.expireAt)
      // TODO update this message
      await this.addMessage('bot', this.sessionExpired)
      // remove session from sessions
      this.endSession()
      return true
    } else {
      // not expired
      return false
    }
  }

  resetExpiration () {
    console.log(this.id, '- resetting expiration')
    // set expireAt for database record time-to-live
    let d = new Date()
    d.setSeconds(d.getSeconds() + Number(process.env.SESSION_TIMEOUT))
    // update cache expireAt
    this.expireAt = d
    // update database record's expireAt
    cumulusDb.updateOne('chat.session', { id: this.id }, { $set: { expireAt: this.expireAt } })
    .catch(e => {
      console.error(this.id, '- error updating chat session expireAt:', e)
    })
  }

  // get dCloud session information from cumulus-api
  getSessionInfo (userId) {
    console.log(this.id, '- getting dCloud session info for', this.dcloudDatacenter.toUpperCase(), this.dcloudSession, userId ? 'for user ' + userId : '')
    const options = {
      method: 'GET',
      url: `${process.env.API_BASE}/api/v1/datacenters/${this.dcloudDatacenter.toUpperCase()}/sessions/${this.dcloudSession}`,
      json: true
    }
    // attach userId as query string, if defined
    if (userId) {
      options.qs = {userId}
    }
    return request(options)
  }

  // add new message to session
  async addMessage (type, message, data) {
    // if message is not empty string
    if (message && message.length) {
      // push message to array
      const datetime = new Date().toJSON()
      const m = {
        text: message,
        type,
        datetime,
        data
      }
      this.messages.push(m)

      // set expireAt for database record time-to-live
      let d = new Date()
      d.setSeconds(d.getSeconds() + Number(process.env.SESSION_TIMEOUT))
      // update cache expireAt
      this.expireAt = d

      // push message to the database record also
      let done = false
      while (!done) {
        try {
          // push message onto array and set the expireAt to new time
          await cumulusDb.updateOne(
            'chat.session',
            { id: this.id },
            { $push: { messages: m }, $set: { expireAt: this.expireAt } }
          )
          done = true
        } catch (e) {
          console.log(this.id, '- failed to add message to database. trying again. error message was: ', e.message)
        }
      }

      // if this is a bot/system/agent message, send it to the customer on facebook
      if (type !== 'customer') {
        // match the Incoming log message format
        console.log(this.id, '- outgoing', type, 'message:', message)
        if (this.onAddMessage && typeof this.onAddMessage === 'function') {
          console.log(this.id, '- sending message using onAddMessage...')
          try {
            this.onAddMessage.call(this, type, message, datetime, data)
            console.log(this.id, '- message sent using onAddMessage.')
          } catch (e) {
            console.log(this.id, '- error sending outgoing message with onAddMessage:', e.message)
          }
        } else {
          console.log(this.id, '- onAddMessage was not a function, so not sending the message with it. onAddMessage was', typeof this.onAddMessage)
        }
      }
    } else {
      // don't add empty messages
    }
  }

  // add new command to messages array
  addCommand (command, data) {
    this.addMessage('command', command, data)
  }

  deescalate () {
    console.log(this.id, '- deescalate session')
    // try to end eGain session
    if (this.egainSession) {
      // end eGain session for PCCE
      this.egainSession.End()
    }
    if (this.smSession) {
      // end SocialMiner connection for UCCX
      this.smSession.stopPolling()
    }
    // remove escalated flag
    this.isEscalated = false
    // start survey if enabled and not started already
    if (this.survey && this.botEnabled) {
      if (!this.inSurvey) {
        this.startSurvey()
      }
    } else {
      // survey not enabled - just end session
      this.endSession()
    }
  }

  // remove session from the database
  endSession () {
    try {
      cumulusDb.removeOne('chat.session', {id: this.id})
      console.log(this.id, '- removed chat session from database.')
      // end websocket, if any
      if (this.websocket) {
        console.log(this.id, '- closed chat session websocket connection.')
        this.websocket.close()
      }
      // remove from cache
      delete cache[this.id]
    } catch (e) {
      console.log(this.id, '- failed to remove chat session from database:', e.message)
    }
  }

  goodbye (message) {
    console.log(`${this.id} goodbye message received. ending chat without survey.`)
    // make sure we don't offer a survey if the user has ended the session with
    // a goodbye message
    this.survey = false
    // deescalate to end the eGain session (if any) and the local session
    this.deescalate()
  }

  async addCustomerMessage (message) {
    const expired = await this.checkExpiration()
    if (expired) {
      // session expired - don't do anything else now, checkExpiration
      // should have called endSession()
      return
    }
    // reset chat session expiration
    this.resetExpiration()
    // add message to memory and database
    this.addMessage('customer', message)
    // detect any goodbye messages that would end the session
    if (process.env.GOODBYE_MESSAGES.toLowerCase().split(',').includes(message.toLowerCase())) {
      this.goodbye(message)
    }
    // detect registration message for instant demo
    if (this.isRegistering) {
      // contact is the phone number associated with this session
      const contact = this.phone
      console.log(this.id, '- trying to register user with phone number', contact, '- customer message was', message)
      // try to register user with the contents of their message
      // check if message contained spaces
      if (message.trim().indexOf(' ') >= 0) {
        console.log(this.id, '- trying to register user with phone number', contact, 'but their message contained spaces. Responding with request for user to re-enter their user ID.')
        // tell user invalid userId and ask for their userId again
        return this.processCustomerMessage('dcloud-user-register-correctly')
      }
      // user ID is the message that user sent (hopefully)
      const userId = message
      // register customer
      this.registerCustomer({userId, contact})
      .then(r => {
        console.log(this.id, '- register user successful with phone number', contact, 'and userId', userId)
        // done registering
        this.isRegistering = false
        // set this.userId to the message user ID
        this.userId = userId
        // send welcome message
        this.processCustomerMessage('sparky')
      })
      .catch(e => {
        console.error(this.id, '- failed attempt to register instant demo phone', contact, 'with', userId)
        // tell user there was an error
        this.processCustomerMessage('dcloud-error')
        // end session
        this.endSession
      })
      return
    }

    // is this chat escalated to an agent?
    if (this.isEscalated) {
      this.sendEscalatedMessage(message)
    } else if (this.botEnabled === false) {
      // if bot disabled, escalate directly to an agent
      console.log(`${this.id} - bot disabled. Escalating directly to agent.`)
      this.escalate(message)
    } else {
      // console.log('getting bot response...')
      // let bot handle the response
      this.processCustomerMessage(message)
    }
  }

  sendEscalatedMessage (message) {
    if (this.demo === 'uccx') {
      // send to uccx session
      console.log(`${this.id} - sending message to UCCX agent.`)
      this.smSession.sendMessage(message)
    } else {
      // send message to eGain agent
      console.log(`${this.id} - sending message to ECE agent.`)
      this.egainSession.SendMessageToAgent(message)
    }
  }

  async processCustomerMessage (text) {
    console.log(this.id, '- processing customer message:', text)
    try {
      // figure out a response using AI
      const response = await this.queryAi(text)
      // console.log(this.id, '- processCustomerMessage response =', response)
      // process the response text
      this.processAiResponse(response.result)

    } catch (e) {
      console.error(`${this.id} exception during processCustomerMessage`, e.message)
    }
  }

  queryAi (text) {
    console.log(this.id, '- querying api.api.ai using token', this.apiAiToken)
    // figure out a response using AI
    return request({
      method: 'POST',
      url: 'https://api.api.ai/v1/query',
      headers: {
        'Authorization': `Bearer ${this.apiAiToken}`,
        'Accept': `application/json`,
        'Content-Type': `application/json; charset=utf-8`
      },
      qs: {
        v: '20170910'
      },
      body: {
        sessionId: this.id,
        q: text,
        lang: this.languageCode
      },
      json: true
    })
  }

  // check the dcloud session info using datacenter and session ID, and respond accordingly
  async checkSessionInfo () {
    console.log(`${this.id} - checking dCloud session info...`)
    if (!this.dcloudDatacenter || !this.dcloudSession) {
      console.log(`${this.id} - dCloud session and datacenter are not set correctly. dcloudDatacenter = ${this.dcloudDatacenter} and dcloudSession = ${this.dcloudSession}`)
      // not set yet
      return false
    }
    try {
      console.log(`${this.id} - dCloud session and datacenter are set. Looking up session info from ${process.env.API_BASE}.`)
      const response = await this.getSessionInfo(this.userId)
      console.log(`${this.id} - found dCloud session and datacenter information`)
      // console.log('dcloud session response', response)

      // check if public address type is configured to use DNS
      if (process.env.PUBLIC_ADDRESS_TYPE.toLowerCase() === 'dns') {
        // use public DNS address of demo
        this.publicAddress = response.dns
      } else {
        // default to use public IP address of demo, to avoid DNS resolution
        this.publicAddress = response.publicIp
      }

      // set egainHost to public DNS of demo vpod for escalating to ECE agent
      this.egainHost = `https://${this.publicAddress}/ece/system`
      console.log(`${this.id} - egainHost = ${this.egainHost}`)
      // set csHost to public DNS of demo vpod for transcript
      this.csHost = `https://${this.publicAddress}/cs`
      console.log(`${this.id} - csHost = ${this.csHost}`)
      // context service API backup
      this.csBackupHost = `https://${this.publicAddress}/cs2`
      console.log(`${this.id} - csBackupHost = ${this.csBackupHost}`)
      // socialminer URL for this session
      this.smHost = `https://${this.publicAddress}/ccp`
      console.log(`${this.id} - smHost = ${this.smHost}`)
      // dCloud demo identifier (pcce or uccx)
      this.demo = response.demo
      console.log(`${this.id} - demo = ${this.demo}`)
      // dCloud demo version (11.6v2, 11.6v3)
      this.demoVersion = response.version
      console.log(`${this.id} - demo version = ${this.demoVersion}`)
      // is this an instant demo session? (multi-user session)
      this.isInstantDemo = response.instant === true || response.instant === 'true'
      console.log(`${this.id} - instant demo = ${this.isInstantDemo}`)
      // set surveyHost to public DNS of demo vpod for saving survey answers
      this.surveyHost = `https://${this.publicAddress}/survey`

      // get any extra configuration the user has set up on their demo
      this.demoConfig = response.configuration || {}
      console.log(this.id, '- demo configuration', this.demoConfig)

      // apply any demo configs for chat bots
      if (this.demoConfig.vertical) {
        this.vertical = this.demoConfig.vertical
        console.log(this.id, '- used dCloud session config to set vertical to', this.vertical)
      }
      if (this.demoConfig.chatBotToken) {
        this.apiAiToken = this.demoConfig.chatBotToken
        console.log(this.id, '- used dCloud session config to update apiAiToken to', this.apiAiToken)
      }
      if (this.demoConfig.language) {
        this.language = this.demoConfig.language
        console.log(this.id, '- used dCloud session config to update language to', this.language)
      }
      if (this.demoConfig.region) {
        this.region = this.demoConfig.region
        console.log(this.id, '- used dCloud session config to update region to', this.region)
      }
      if (this.demoConfig.chatBotEnabled) {
        this.botEnabled = this.demoConfig.chatBotEnabled
        console.log(this.id, '- used dCloud session config to update botEnabled to', this.botEnabled)
      }
      if (this.demoConfig.chatBotSurveyEnabled) {
        this.survey = this.demoConfig.chatBotSurveyEnabled
        console.log(this.id, '- used dCloud session config to update survey to', this.survey)
      }
      if (this.demoConfig.chatCsqId) {
        // prefix the ID with Chat_Csq_ for UCCX chat form to work
        this.csq = 'Chat_Csq' + this.demoConfig.chatCsqId
        console.log(this.id, '- used dCloud session config to update UCCX chat CSQ ID to', this.csq)
      }
      // update language code
      this.languageCode = `${this.language.toLowerCase()}-${this.region.toUpperCase()}`
      console.log(this.id, '- used dCloud session config to update languageCode to', this.languageCode)
      // continue
    } catch (e) {
      console.error(`${this.id} - error getting dcloud session info for ${this.dcloudDatacenter} ${this.dcloudSession}`, e.message)
      // reset the session info to null
      this.dcloudDatacenter = null
      this.dcloudSession = null
      // failed
      return false
    }

    try {
      // now get vertical config and apply it on top of demo session config
      // this is to transition from demo session configuration values to using
      // the branding tool for all customization options
      const r2 = await this.getVerticalInfo()
      console.log(`${this.id} - found dCloud vertical config for vertical "${this.vertical}"`)
      if (r2.chatBotToken) {
        this.apiAiToken = r2.chatBotToken
        console.log(this.id, '- used dCloud vertical config to update apiAiToken to', this.apiAiToken)
      }
      if (r2.languageCode) {
        this.languageCode = r2.languageCode
        console.log(this.id, '- used dCloud vertical config to update languageCode to', this.languageCode)
      }
      if (r2.chatBotEnabled) {
        this.botEnabled = r2.chatBotEnabled
        console.log(this.id, '- used dCloud vertical config to update botEnabled to', this.botEnabled)
      }
      if (r2.chatBotSurveyEnabled) {
        this.survey = r2.chatBotSurveyEnabled
        console.log(this.id, '- used dCloud vertical config to update survey to', this.survey)
      }
    } catch (e) {
      console.error(`${this.id} - error getting dcloud vertical config info for ${this.vertical}`, e.message)
      // failed?
      // return false
    }

    // this commented section is not necessary until instant demo user config
    // is stored in the cloud db. now it is stored inside the demo session and
    // mm takes care of retrieving it
    // try {
    //   // in the instant demo, get customer information so we can route chat properly
    //   if (this.isInstantDemo) {
    //     // look up customer using phone or email field data
    //     const r3 = await this.getCustomerInfo()
    //     if (r3) {
    //       // a matching customer was found
    //       // get instant demo instance info
    //       const r4 = await this.getInstantDemoInstance()
    //       if (r4) {
    //         // create instant demo identifier
    //         const instanceId = r4.datacenter + '-' + r4.id
    //         // modify the demo version string for matching in mongodb
    //         const modifiedVersion = this.demoVersion.replace(/\./g, ',')
    //         // extract demo config for this customer for this demo instance
    //         const d = r3.demo[this.demo].instant[modifiedVersion][instanceId]
    //         if (d.chatCsqId) {
    //           // extract UCCX chat CSQ ID for this customer
    //           this.csq = d.chatCsqId
    //           console.log(this.id, '- used dCloud session config to update UCCX chat CSQ ID to', this.csq)
    //         }
    //       } else {
    //         console.log(this.id, '- instant demo instance not found')
    //       }
    //     } else {
    //       console.log(this.id, '- customer info not found')
    //     }
    //   }
    // } catch (e) {
    //   console.error(`${this.id} - error getting instant demo customer info:`, e.message)
    //   // failed?
    //   // return false
    // }

    // success
    return true
  }

  // get vertical config data from mm server
  getVerticalInfo () {
    return cumulusDb.findOne('vertical', {id: this.vertical}, {_id: 0})
  }

  // find instant demo customer record in cloud db
  // not used yet
  getCustomerInfo () {
    const query = {
      'customer.contact': {
        $in: [this.phone, this.email]
      }
    }
    // don't return the internal _id or user's password from db query
    const projection = {
      _id: 0,
      password: 0
    }
    // run db query
    return toolboxDb.findOne('users', query, {projection})
  }

  // find the instant demo instance details in cloud db
  async getInstantDemoInstance () {
    // find the instant demo matching details for this session
    const query = {
      datacenter: this.dcloudDatacenter,
      session: this.dcloudSession,
      version: this.demoVersion,
      demo: this.demo
    }
    // don't return the internal _id from db query
    const projection = { _id: 0 }
    // run db query
    return toolboxDb.findOne('instance', query, {projection})
  }

  // register customer in instant demo
  registerCustomer ({userId, contact}) {
    return request({
      baseUrl: 'https://' + this.publicAddress,
      method: 'POST',
      url: '/api/v1/' + this.demo + '/public/customer',
      headers: {
        authorization: 'Bearer ' + process.env.REGISTER_CUSTOMER_TOKEN
      },
      json: true,
      body: {userId, contact}
    })
  }

  async getCustomerIsRegistered (contact) {
    try {
      const response = await request({
        baseUrl: 'https://' + this.publicAddress,
        method: 'GET',
        url: '/api/v1/' + this.demo + '/public/customer/' + contact,
        headers: {
          authorization: 'Bearer ' + process.env.GET_CUSTOMER_TOKEN
        },
        json: true
      })
      // parse response
      return response.exists
    } catch (e) {
      console.log(this.id, '- failed to getCustomerIsRegistered for instant demo:', e.message)
      return false
    }
  }

  async checkInstantDemoCustomer (aiMessage) {
    try {
      // is this an instant demo? then we might need to look up the
      // userId inside the demo session
      console.log(this.id, '- this is an instant demo. Checking user registration...')
      // check if the customer phone is registered in the instant demo system
      const phoneIsRegistered = await this.getCustomerIsRegistered(this.phone)
      if (phoneIsRegistered) {
        // is registered
        console.log(this.id, '- instant demo - customer phone is already registered. Continue with bot script.')
        // if aiMessage passed, start dialog with that message
        if (aiMessage) {
          this.processCustomerMessage(aiMessage)
        }
        // done
        return
      }
      // check if customer email is registered in the instant demo
      // const emailIsRegistered = await this.getCustomerIsRegistered(this.email)
      // if (emailIsRegistered) {
      //   // is registered
      //   console.log(this.id, '- instant demo - customer email is already registered. Continue with bot script.')
      //   // if aiMessage passed, start dialog with that message
      //   if (aiMessage) {
      //     return this.processCustomerMessage(aiMessage)
      //   }
      // }
      // not registered - ask customer to register
      console.log(this.id, 'instant demo - customer phone is not registered. Requesting that customer register now. Customer phone =', this.phone)
      // set session state to isRegistering
      this.isRegistering = true
      // send keyword to AI to send AI response to customer asking customer to register
      return this.processCustomerMessage('dcloud-user-register')
    } catch (e) {
      throw e
    }
  }

  async processAiResponse (result) {
    console.log(this.id, '- processAiResponse - result.action =', result.action)
    const fulfillment = result.fulfillment
    // check the api.ai response message and perform the associated action
    switch (result.action) {
      case 'datacenter': {
        if (fulfillment.speech.length) {
          // add bot's reply to session's messages list
          for (let message of fulfillment.messages) {
            this.addMessage('bot', message.speech)
          }
        }
        // set datacenter
        this.dcloudDatacenter = result.parameters.dc
        // get session info now
        if (this.dcloudSession && this.dcloudDatacenter) {
          const valid = await this.checkSessionInfo()
          if (valid) {
            // check if we are isEscalating now or just showing instructions
            if (this.isEscalating) {
              // escalate
              this.escalate()
            } else if (this.isInstantDemo) {
              try {
                this.checkInstantDemoCustomer('sparky')
              } catch (e) {
                console.error(this.id, '- failed to check instant demo customer', e.message)
              }
            } else {
              // send instructions
              this.processCustomerMessage('instructions')
            }
          } else {
            // try to get info from customer again
            this.processCustomerMessage('wrong-information')
          }
        }
        break
      }
      case 'dcloud-session': {
        // console.log('ai response', result)
        if (fulfillment.speech.length) {
          // add bot's reply to session's messages list
          for (let message of fulfillment.messages) {
            this.addMessage('bot', message.speech)
          }
        }
        // set dcloud session ID
        this.dcloudSession = result.parameters.session
        // get session info now
        if (this.dcloudSession && this.dcloudDatacenter) {
          const valid = await this.checkSessionInfo()
          if (valid) {
            // check if we are isEscalating now or just showing instructions
            if (this.isEscalating) {
              // escalate
              this.escalate()
            } else if (this.isInstantDemo) {
              try {
                this.checkInstantDemoCustomer('sparky')
              } catch (e) {
                console.error(this.id, '- failed to check instant demo customer', e.message)
              }
            } else {
              // send instructions
              this.processCustomerMessage('instructions')
            }
          } else {
            // try to get info from customer again
            this.processCustomerMessage('wrong-information')
          }
        }
        break
      }
      case 'escalate': {
        if (fulfillment.speech !== 'escalate' && fulfillment.speech.length) {
          // add bot's reply to session's messages list
          for (let message of fulfillment.messages) {
            this.addMessage('bot', message.speech)
          }
        }
        // escalate request to agent
        this.escalate()
        break
      }
      case 'start-video': {
        if (this.type === 'sparky-ui') {
          // add bot's reply to session's messages list
          for (let message of fulfillment.messages) {
            this.addMessage('bot', message.speech)
          }
          // start REM call
          this.addCommand('start-rem-video')
        } else {
          this.addMessage('bot', localization[this.languageCode].noVideo)
        }
        break
      }
      case 'mortgage-calculator': {
        console.log(`${this.id} - sending mortgage-calculator command`)
        if (this.type === 'sparky-ui') {
          this.addMessage('bot', localization[this.languageCode].calculatorAppeared)
          // open mortgage calculator
          this.addCommand('mortgage-calculator')
        } else {
          this.addMessage('bot', localization[this.languageCode].calculator + ' ' + process.env.CALCULATOR_URL)
        }
        break
      }
      case 'survey-response': {
        // save the last survey answer
        this.surveyAnswers.push(result.parameters.surveyscore)
        // add bot's reply to session's messages list
        for (let message of fulfillment.messages) {
          this.addMessage('bot', message.speech)
        }
        break
      }
      case 'survey-end': {
        console.log(`${this.id} - ending survey and sending survey answers to demo now`)
        // save the last survey answer
        this.surveyAnswers.push(result.parameters.surveyscore)
        // out of survey now
        this.inSurvey = false
        // add bot's reply to session's messages list
        for (let message of fulfillment.messages) {
          this.addMessage('bot', message.speech)
        }
        if (this.type !== 'sparky-ui') {
          // end of survey should end the session for bots other than sparky-ui
          // this.deescalate()
          this.endSession()
        }
        // send the survey results to the node service running in the demo
        try {
          await this.saveSurveyAnswers()
          console.log(this.id, '- saved survey answers')
        } catch (e) {
          console.log(this.id, '- Failed to save survey answers', e.message)
        }

        break
      }
      // case 'start-survey': {
      //   this.startSurvey()
      //   break
      // }
      case 'end-session': {
        // end session
        if (this.survey) {
          this.startSurvey()
        } else {
          // survey not enabled - just go to deescalate
          // this.deescalate()
          this.endSession()
        }
        break
      }
      case 'change-brand-url': {
        // change the branding page background URL
        // add bot's reply to session's messages list
        for (let message of fulfillment.messages) {
          this.addMessage('bot', message.speech)
        }
        console.log(this.id, '- sending change-brand-url command to UI with URL =', result.parameters.url)
        // send command to UI
        this.addCommand('change-brand-url', result.parameters.url)
        break
      }
      default: {
        // add bot's reply to session's messages list
        for (let message of fulfillment.messages) {
          this.addMessage('bot', message.speech)
        }
        break
      }
    }
  }

  // save survey answers to database on the demo instance
  async saveSurveyAnswers () {
    const url = `${this.surveyHost}`
    // {answers: this.surveyAnswers}
    const body = {
      surveyId: process.env.SURVEY_ID,
      ani: this.phone,
      name: `${this.firstName} ${this.lastName}`,
      q1: this.surveyAnswers[0] || '0',
      q2: this.surveyAnswers[1] || '0'
    }
    const options = {
      // headers: {
      //   'Authorization': `Bearer ${token}`
      // }
    }
    await axios.post(url, body, options)
  }

  async escalate (message) {
    console.log(this.id, '- starting escalate to an agent...')
    if (!this.demo) {
      // check if session is valid, and get the session info
      const valid = await this.checkSessionInfo()
      if (!valid) {
        // try to get info from customer again
        // TODO use a different message?
        this.processCustomerMessage('wrong-information')
        this.isEscalating = true
        return
      }
    }

    // send the chat transcript to Context Service
    try {
      console.log(`${this.id} - sending chat transcript...`)
      await transcript.send(this)
      console.log(`${this.id} - transcript sent.`)
    } catch (e) {
      console.log(`${this.id} - failed to send transcript:`, e.message)
    }

    if (this.demo && this.demo === 'uccx') {
      console.log(`${this.id} - Escalating to UCCX agent`)
      // escalate to SM on UCCX demo
      this.escalateToSocialMiner(message)
    } else {
      console.log(`${this.id} - Escalating to PCCE agent`)
      // default to PCCE
      this.escalateToEgain(message)
    }
  }

  escalateToSocialMiner(message) {
    console.log(`${this.id} - escalating to SocialMiner agent`)

    // set up UCCX chat system
    try {
      console.log(this.id, 'setting up uccx chat client to', this.smHost, '...')
      let form
      let csq
      let title
      // set the form, csq, and title based on session type
      switch (this.type) {
        case 'facebook': {
          // facebook chat
          form = process.env.UCCX_CHAT_FACEBOOK_FORM_ID || '100000'
          csq = this.csq || process.env.UCCX_CHAT_FACEBOOK_CSQ || 'Chat_Csq28'
          title = 'Facebook Messenger'
          break
        }
        case 'twilio': {
          // twilio
          form = process.env.UCCX_SMS_FORM_ID || '100000'
          csq = this.csq || process.env.UCCX_SMS_CSQ || 'Chat_Csq2'
          title = 'SMS'
          break
        }
        case 'spark': {
          // Webex Teams (spark)
          form = process.env.UCCX_TEAMS_FORM_ID || '100000'
          csq = this.csq || process.env.UCCX_TEAMS_CSQ || 'Chat_Csq2'
          title = 'Webex Teams'
          break
        }
        default: {
          // web chat or other
          if (this.botEnabled) {
            // bot enabled
            form = process.env.UCCX_CHAT_BOT_FORM_ID || '100000'
            csq = this.csq || process.env.UCCX_CHAT_BOT_CSQ || 'Chat_Csq31'
            title = 'Chat Bot'
          } else {
            // bot disabled
            form = process.env.UCCX_CHAT_FORM_ID || '100000'
            csq = this.csq || process.env.UCCX_CHAT_CSQ || 'Chat_Csq3'
            title = 'Chat Bot'
          }
          break
        }
      }
      const chatData = {
        urlBase: this.smHost,
        form,
        csq,
        title,
        customerName: `${this.firstName} ${this.lastName}`,
        author: `${this.firstName} ${this.lastName}`,
        // author: '',
        customerEmail: this.email,
        customerPhone: this.phone,
        pollingInterval: 2000
      }
      console.log(this.id, 'uccx chat client initializing with data:', chatData)
      const uccx = new uccxChatClient(chatData)
      console.log(this.id, 'uccx chat client created. setting up handlers...')
      uccx.setHandlers(smEventHandlers.create(uccx, this))
      console.log(this.id, 'uccx chat handlers set up.')
      // save a reference to SocialMiner session
      this.smSession = uccx
      // start chat session
      this.smSession.start()
      // set escalated flag
      this.isEscalated = true
      // tell customer we are finding an agent by sending a message to DialogFlow for a response
      // this.addCustomerMessage('system', 'dcloud-finding-agent')
      // this.addMessage('system', localization[this.languageCode].welcomeMessage)
    } catch (e) {
      console.error('error starting UCCX chat', e)
    }
  }

  escalateToEgain (message) {
    console.log(`${this.id} - escalating to eGain/ECE agent`)
    // console.log('escalate session:', this)
    // build customer object for connection to eGain
    const customerObject = require('./egainCustomer').create({
      egainHost: this.egainHost,
      firstName: this.firstName,
      lastName: this.lastName,
      email: this.email,
      phone: this.phone,
      subject: message,
      pkey: !this.phone.length ? 'email' : 'phone'
      // visitId: this.visitId
    })

    try {
      const myLibrary = egainLibrary.get(this.egainHost)
      // create instance of ECE chat object
      const myChat = new myLibrary.Chat()
      // build ECE chat event handlers
      const myEventHandlers = egainEventHandlers.create(myChat, this)
      // init the ECE chat object
      myChat.Initialize(this.entryPointId, this.language, this.region, myEventHandlers, 'aqua', 'v11')
      // set ECE chat customer object
      myLibrary.SetCustomer(customerObject)
      // start chat with ECE system
      myChat.Start()
      // add reference to ECE session in the session global
      this.egainSession = myChat
      // set escalated flag
      this.isEscalated = true
    } catch (e) {
      console.error('error starting ECE chat', e)
    }
  }

  onEgainEnd () {
    this.deescalate()
  }

  onEgainFail (args) {
    switch (args.StatusMessage) {
      case 'L10N_NO_AGENTS_AVAILABLE': {
        // tell customer that there are no agents available
        this.addMessage('system', localization[this.languageCode].noAgentsAvailable)
        // turn off survey
        this.survey = false
        // end egain session
        if (this.egainSession) {
          this.egainSession.End()
        }
        // remove escalated flag
        this.isEscalated = false
        // return to current session with the bot
        break
      }
      case 'L10N_SYSTEM_CANNOT_ASSIGN_AGENT': {
        // tell customer that there are no agents available
        this.addMessage('system', localization[this.languageCode].cannotAssignAgent)
        // turn off survey
        this.survey = false
        // end egain session
        if (this.egainSession) {
          this.egainSession.End()
        }
        // remove escalated flag
        this.isEscalated = false
        // return to current session with the bot
        break
      }
      default: {
        // just deescalate
        this.deescalate()
        break
      }
    }

  }

  startSurvey () {
    // egain session ended - now provide chat survey
    this.inSurvey = true
    // start survey conversation by saying 'survey' to bot AI
    this.processCustomerMessage('survey')
  }

}

module.exports = Session
