const uuidv1 = require('uuid/v1')
const egainLibrary = require('./egainLibrary.js')
const request = require('request-promise-native')
const egainEventHandlers = require('./egainEventHandlers')
const transcript = require('./transcript')
const axios = require('axios')
const util = require('util')
const uccxChatClient = require('uccx-chat-client')
const smEventHandlers = require('./smEventHandlers')
const localization = require('./localization')

class Session {
  constructor (type, data) {
    this.id = uuidv1()
    this.state = 'active'
    // set timestamp
    this.timestamp = new Date().getTime()
    // sessions expiry
    this.resetExpiration()

    this.inSurvey = false
    this.isEscalated = false
    this.messages = []
    this.phone = data.phone
    this.email = data.email
    this.username = data.username
    this.firstName = data.firstName
    this.lastName = data.lastName

    // set language and country (region)
    this.language = data.language || process.env.DEFAULT_LANGUAGE || 'en'
    this.region = data.region || process.env.DEFAULT_REGION || 'US'

    this.languageCode = `${this.language.toLowerCase()}_${this.region.toUpperCase()}`
    // set localization object
    this.localization = localization[this.languageCode]

    // run this callback at de-escalation time
    this.removeSession = data.removeSession
    // run this callback when messages are added
    this.onAddMessage = data.onAddMessage
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
    if (typeof this.data.survey === 'undefined') {
      this.data.survey = true
    }
    // console.log(`creating ${this.type} Sparky session ${this.id}: for ${this.firstName} ${this.lastName} with AI token ${this.apiAiToken} for entry point ${this.entryPointId} and survey is ${this.data.survey ? 'enabled' : 'disabled'}`)
    const logData = JSON.parse(JSON.stringify(this))
    console.log(this.id, '- new', this.type, 'session created for', this.email, this)
    // create survey answers array
    this.surveyAnswers = []

    // if we have dcloud session and datacenter info, check the session info now
    if (this.dcloudSession && this.dcloudDatacenter) {
      this.checkSessionPromise = this.checkSessionInfo()
    }
  }

  checkExpiration () {
    // did session expire?
    if (new Date().getTime() > this.expiry) {
      console.log(`${this.id} - session is old and has expired. Informing user about it and remove this session.`)
      // TODO update this message
      this.addMessage('bot', this.sessionExpired)
      //remove session from sessions
      this.endSession()
    }
  }

  resetExpiration () {
    // reset expiry to current time + configured timeout value
    this.expiry = new Date().getTime() + 1000 * process.env.SESSION_TIMEOUT
  }

  // get dCloud session information
  getSessionInfo (username) {
    const options = {
      method: 'GET',
      url: `${process.env.API_BASE}/api/v1/datacenters/${this.dcloudDatacenter.toUpperCase()}/sessions/${this.dcloudSession}`,
      json: true
    }
    // attach username as query string, if defined
    if (username) {
      options.qs = {username}
    }
    return request(options)
  }

  // add new message to session
  addMessage (type, message) {
    // if message is not empty string
    if (message && message.length) {
      // push message to array
      this.messages.push({
        text: message,
        type,
        datetime: new Date().toJSON()
      })
      // if this is a bot/system/agent message, send it to the customer on facebook
      if (type !== 'customer') {
        // match the Incoming log message format
        console.log(this.id, '- outgoing message')
        if (this.onAddMessage && typeof this.onAddMessage === 'function') {
          this.onAddMessage.call(this, type, message)
        }
      }
    } else {
      // don't add empty messages
    }
  }

  // add new command to messages array
  addCommand (command, data) {
    this.messages.push({
      text: command,
      type: 'command',
      datetime: new Date().toJSON(),
      data
    })
    // TODO if facebook client, possibly send different command message to facebook
  }

  deescalate () {
    console.log(`deescalate session`)
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
    if (this.data.survey && this.botEnabled) {
      if (!this.inSurvey) {
        this.startSurvey()
      }
    } else {
      // survey not enabled - just end session
      this.endSession()
    }
  }

  endSession () {
    // call custom removeSession handler
    if (this.removeSession && typeof this.removeSession === 'function') {
      console.log(`${this.id} - calling removeSession handler`)
      this.removeSession.call(this)
    } else {
      console.log(`${this.id} - removeSession not a function. removeSession =`, this.removeSession)
    }
  }

  goodbye (message) {
    console.log(`${this.id} goodbye message received. ending chat without survey.`)
    // make sure we don't offer a survey if the user has ended the session with
    // a goodbye message
    this.data.survey = false
    // deescalate to end the eGain session (if any) and the local session
    this.deescalate()
  }

  addCustomerMessage (message) {
    // reset session expiration
    this.resetExpiration()
    // add message to memory
    this.addMessage('customer', message)
    // detect any goodbye messages that would end the session
    if (process.env.GOODBYE_MESSAGES.toLowerCase().split(',').includes(message.toLowerCase())) {
      this.goodbye(message)
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
    try {
      // figure out a response using AI
      const response = await this.queryAi(text)
      // console.log('processCustomerMessage response =', response)
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
        lang: this.language
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
      const response = await this.getSessionInfo(this.username)
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
      console.log(this.id, 'demo configuration', this.demoConfig)

      // apply any demo configs for chat bots
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
      // update language code
      this.languageCode = `${this.language.toLowerCase()}_${this.region.toUpperCase()}`
      console.log(this.id, '- used dCloud session config to update languageCode to', this.languageCode)
      // update localization object
      this.localization = localization[this.languageCode]
      console.log(this.id, '- used dCloud session config to update localization to', this.localization)

      // success
      return true
    } catch (e) {
      console.error(`${this.id} - error getting dcloud session info for ${this.dcloudDatacenter} ${this.dcloudSession}`, e.message)
      // reset the session info to null
      this.dcloudDatacenter = null
      this.dcloudSession = null
      // failed
      return false
    }
  }

  // register customer in instant demo
  registerCustomer ({username, contact}) {
    return request({
      baseUrl: 'https://' + this.publicAddress,
      method: 'POST',
      url: '/api/v1/pcce/app/customer',
      headers: {
        authorization: 'Bearer ' + process.env.INSTANT_DEMO_TOKEN
      },
      json: true,
      body: {username, contact}
    })
  }

  getCustomerIsRegistered (contact) {
    return  request({
      baseUrl: 'https://' + this.publicAddress,
      method: 'GET',
      url: '/api/v1/pcce/app/customer/' + contact,
      headers: {
        authorization: 'Bearer ' + process.env.INSTANT_DEMO_TOKEN
      },
      json: true
    })
  }

  async checkInstantDemoCustomer (aiMessage) {
    try {
      // is this an instant demo? then we might need to look up the
      // username inside the demo session
      console.log(this.id, '- this is an instant demo. Checking user registration...')
      // check if the customer is registered in the instant demo system
      const phoneIsRegistered = await this.getCustomerIsRegistered(this.phone)
      const emailIsRegistered = await this.getCustomerIsRegistered(this.email)

      // parse responses
      const isRegistered = phoneIsRegistered.exists || emailIsRegistered.exists

      if (isRegistered) {
        // is registered
        console.log(this.id, '- instant demo - customer phone or email is already registered. Continue with bot script.')
        // if aiMessage passed, start dialog with that message
        if (aiMessage) {
          this.processCustomerMessage(aiMessage)
        }
      } else {
        // not registered - ask customer to register
        console.log(this.id, 'instant demo - customer phone and email are not registered. Requesting that customer register now.')
        this.processCustomerMessage('registration')
      }
    } catch (e) {
      throw e
    }
  }

  async processAiResponse (result) {
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
                this.checkInstantDemoCustomer()
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
                this.checkInstantDemoCustomer()
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
          this.addMessage('bot', this.localization.noVideo)
        }
        break
      }
      case 'mortgage-calculator': {
        console.log(`${this.id} - sending mortgage-calculator command`)
        if (this.type === 'sparky-ui') {
          this.addMessage('bot', this.localization.calculatorAppeared)
          // open mortgage calculator
          this.addCommand('mortgage-calculator')
        } else {
          this.addMessage('bot', this.localization.calculator + ' ' + process.env.CALCULATOR_URL)
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
          console.log('saved survey answers')
        } catch (e) {
          console.log('Failed to save survey answers', e.message)
        }

        break
      }
      // case 'start-survey': {
      //   this.startSurvey()
      //   break
      // }
      case 'end-session': {
        // end session
        if (this.data.survey) {
          this.startSurvey()
        } else {
          // survey not enabled - just go to deescalate
          // this.deescalate()
          this.endSession()
        }
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
    if (!this.demo) {
      // check if session is valid, and get the session info
      const valid = await this.checkSessionInfo()
      if (!valid) {
        // try to get info from customer again
        // TODO use a different message?
        this.processCustomerMessage('wrong-information')
        this.isEscalating = true
        return
      } else {
        // continue escalation
      }
    }

    // send the chat transcript to Context Service
    try {
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
          csq = process.env.UCCX_CHAT_FACEBOOK_CSQ || 'Chat_Csq28'
          title = 'Facebook Messenger'
          break
        }
        case 'twilio': {
          // twilio
          form = process.env.UCCX_SMS_FORM_ID || '100000'
          csq = process.env.UCCX_SMS_CSQ || 'Chat_Csq2'
          title = 'SMS'
          break
        }
        case 'spark': {
          // Webex Teams (spark)
          form = process.env.UCCX_TEAMS_FORM_ID || '100000'
          csq = process.env.UCCX_TEAMS_CSQ || 'Chat_Csq2'
          title = 'Webex Teams'
          break
        }
        default: {
          // web chat or other
          if (this.botEnabled) {
            // bot enabled
            form = process.env.UCCX_CHAT_BOT_FORM_ID || '100000'
            csq = process.env.UCCX_CHAT_BOT_CSQ || 'Chat_Csq_31'
            title = 'Chat Bot'
          } else {
            // bot disabled
            form = process.env.UCCX_CHAT_FORM_ID || '100000'
            csq = process.env.UCCX_CHAT_CSQ || 'Chat_Csq3'
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
        customerPhone: this.phone
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
      // tell customer we are finding an agent
      // this.addMessage('system', `Please wait while we connect you with a customer care representative...`)
      this.addMessage('system', this.localization.welcomeMessage)
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
        this.addMessage('system', this.localization.noAgentsAvailable)
        // turn off survey
        this.data.survey = false
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
