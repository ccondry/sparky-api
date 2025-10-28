const uuidv1 = require('uuid/v1')
const egainLibrary = require('./egainLibrary.js')
const request = require('request-promise-native')
const egainEventHandlers = require('./egainEventHandlers')
// const transcript = require('./transcript')
const axios = require('axios')
// const util = require('util')
const uccxChatClient = require('uccx-chat-client')
const smEventHandlers = require('./smEventHandlers')
const localization = require('./models/localization')
const db = require('./models/db')
const cache = require('./models/sessions')
const credentials = require('./models/credentials')
const dialogflow = require('dialogflow').v2beta1
// webex teams logger
const teamsLogger = require('./models/teams-logger')
// webex teams library
const teams = require('./models/teams')
const wxm = require('./models/wxm')

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getDialogFlowV2Parameters (result) {
  // get a more usable parameter JSON
  const keys = Object.keys(result.parameters.fields)
  const output = {}
  for (const key of keys) {
    const param = result.parameters.fields[key]
    output[key] = param[param.kind]
  }
  return output
}

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
      console.log(this.id, '- new chat session of type', type, 'started.')
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
    console.log(this.id, '- phone =', this.phone)
    this.email = data.email
    console.log(this.id, '- email =', this.email)
    this.userId = data.userId
    console.log(this.id, '- userId =', this.userId)
    this.firstName = data.firstName
    console.log(this.id, '- firstName =', this.firstName)
    this.lastName = data.lastName
    console.log(this.id, '- lastName =', this.lastName)

    // set language and country (region)
    this.language = data.language || process.env.DEFAULT_LANGUAGE || 'en'
    this.region = data.region || process.env.DEFAULT_REGION || 'US'

    // set language code
    this.languageCode = data.languageCode || `${this.language.toLowerCase()}-${this.region.toUpperCase()}`
    console.log(this.id, '- languageCode =', this.languageCode)

    // run this callback when messages are added
    this.onAddMessage = onAddMessage

    // run this callback when agent starts typing
    this.onTypingStart = onTypingStart

    // run this callback when messages are added
    this.onTypingStop = onTypingStop

    // resolve this promise to get user data
    // this.getCustomerData = data.getCustomerData

    // dialogFlow API v2 project ID
    this.gcpProjectId = data.gcpProjectId || process.env.GCP_PROJECT_ID
    // trim whitespace off
    this.gcpProjectId = this.gcpProjectId.trim()

    // get dialogflow GCP credentials from database
    // and save a reference to the promise
    this.updateGcpCredentialsPromise = this.updateGcpCredentials()

    this.entryPointId = data.entryPointId || process.env.ENTRY_POINT_ID

    // dCloud session information
    this.dcloudSession = data.dcloudSession
    this.dcloudDatacenter = data.dcloudDatacenter

    if (data.botEnabled === false) {
      this.botEnabled = false
    } else {
      this.botEnabled = true
    }
    console.log(this.id, '- botEnabled =', this.botEnabled)
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
    
    // flag to know whether we have sent the initial welcome message after\
    // getting datacenter and session info for a facebook chat session
    this.hasSentVerticalWelcome = false
  }

  // set the agent ID who handled this chat. used for survey data.
  setAgentId (id) {
    this.agentId = id
  }

  // get a localized string from models/localization
  getLocalizedText (id) {
    try {
      const a = localization[this.languageCode][id]
      if (a) {
        return a
      }
    } catch (e) {
      // continue
    }
    return localization['en-US'][id] || ''
  }

  async updateGcpCredentials () {
    const oldGcpId = this.gcpProjectId
    let r
    try {
      r = await credentials.get(this.gcpProjectId)
    } catch (e) {
      // failed to get credentials
      console.log(this.id, '- failed to get GCP credentials from database for project ID', this.gcpProjectId, e.message)
      // reset GCP project ID to default
      console.log(this.id, '- reverting to default GCP credentials using project ID', process.env.GCP_PROJECT_ID)
      this.gcpProjectId = process.env.GCP_PROJECT_ID
      // get credentials again
      try {
        r = await credentials.get(this.gcpProjectId)
      } catch (e2) {
        console.log(this.id, '- failed to get default GCP credentials from database:', e.message)
        this.addMessage('system', `There was an error loading the JSON credentials for your DialogFlow project ID ${oldGcpId}: ${e.message}`)
        this.addMessage('system', `I tried to load the default DialogFlow credentials (project ID ${this.gcpProjectId}), but there was another error: ${e2.message}`)
        throw e2
      }
    }

    // save credentials to session info
    this.gcpCredentials = r
    console.log(this.id, '- got GCP credentials from database for project ID', this.gcpProjectId)
    // Create a new session client for dialogflow for this project/credential pair
    // const sessionClient = new dialogflow.SessionsClient({projectId, keyFilename})
    this.sessionClient = new dialogflow.SessionsClient({
      projectId: this.gcpProjectId,
      credentials: this.gcpCredentials
    })
    // build dialogflow session path
    this.sessionPath = this.sessionClient.sessionPath(this.gcpProjectId, this.id)
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
    db.updateOne('cumulus', 'chat.session', { id: this.id }, { $set: { expireAt: this.expireAt } })
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
    // ignore empty messages
    if (typeof message !== 'string' || message.length === 0) {
      return
    }
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
        await db.updateOne(
          'cumulus',
          'chat.session',
          { id: this.id },
          { $push: { messages: m }, $set: { expireAt: this.expireAt } }
        )
        done = true
      } catch (e) {
        console.log(this.id, '- failed to add message to database. trying again. error message was: ', e.message)
        await sleep(2000)
      }
    }

    // if this is a bot/system/agent message, send it to the customer
    if (type !== 'customer') {
      // match the Incoming log message format
      console.log(this.id, '- outgoing', type, 'message:', message)
      if (typeof this.onAddMessage === 'function') {
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
      console.log(this.id, '- survey and bot are enabled.')
      if (!this.inSurvey) {
        console.log(this.id, '- not in survey yet. Starting post-chat survey.')
        this.startSurvey()
      } else {
        console.log(this.id, '- already in survey.')
      }
    } else {
      // survey not enabled - just end session
      console.log(this.id, '- survey =', this.survey, 'and botEnabled =', this.botEnabled)
      console.log(this.id, '- not starting post-chat survey. Just end the session.')
      this.endSession()
    }
  }

  // remove session from the database
  endSession () {
    try {
      db.removeOne('cumulus', 'chat.session', {id: this.id})
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
    // make sure we have the right vertical set before trying to say sparky
    await this.updateGcpCredentialsPromise
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
        this.hasSentVerticalWelcome = true
      })
      .catch(e => {
        console.error(this.id, '- failed attempt to register instant demo phone', contact, 'with', userId, ':', e.message)
        // tell user there was an error
        this.processCustomerMessage('dcloud-user-register-try-again')
        // end session
        this.endSession
      })
      return
    }

    // is this chat escalated to an agent?
    if (this.isEscalated) {
      try {
        await this.sendEscalatedMessage(message)
      } catch (e) {
        console.log(`${this.id} - failed to escalate to agent:`, e.message)
        // throw e
      }
    } else if (this.botEnabled === false) {
      // if bot disabled, escalate directly to an agent
      console.log(`${this.id} - bot disabled. Escalating directly to agent.`)
      this.escalate(message)
    } else if (this.inSurvey && this.useVerticalSurvey) {
      this.processSurveyAnswer(message)
    } else {
      // console.log('getting bot response...')
      // let bot handle the response
      this.processCustomerMessage(message)
    }
  }

  processSurveyAnswer (message) {
    // process survey answers here instead of sending to the bot
    const surveyAnswer = Number.parseInt(message)
    // validate survey answer is a number 0 to 9
    if (
      Number.isNaN(surveyAnswer) ||
      surveyAnswer < 0 ||
      surveyAnswer > 9
    ) {
      // re-ask question
      this.addMessage('bot', this.surveyQuestions[this.surveyIndex])
      return
    }

    this.surveyAnswers.push(surveyAnswer)
    this.surveyIndex++
    const surveyQuestion = this.surveyQuestions[this.surveyIndex]
    // if next question exists
    if (surveyQuestion) {
      // ask next question
      this.addMessage('bot', surveyQuestion)
      return
    }
    
    // else end of survey
    this.inSurvey = false
    // say survey goodbye
    this.addMessage('bot', this.surveyGoodbye)
    if (this.type !== 'sparky-ui') {
      // end of survey should end the session for bots other than sparky-ui
      this.endSession()
    }
    // send the survey results to the node service running in the demo
    this.saveSurveyAnswers()
  }

  async sendEscalatedMessage (message) {
    if (this.demo === 'uccx') {
      // send to uccx session
      console.log(`${this.id} - sending message to UCCX agent.`)
      try {
        await this.smSession.sendMessage(message)
        console.log(`${this.id} - successfully sent message to UCCX agent.`)
      } catch (e) {
        console.log(`${this.id} - failed to send message to UCCX agent:`, e.message)
        // check for ETIMEDOUT errors
        if (e.message.indexOf('ETIMEDOUT') >= 0) {
          // log to Teams
          teamsLogger.log(`${this.id} - timed out error - failed to send message to UCCX agent in ${this.dcloudDatacenter} ${this.dcloudSession}: ${e.message}`)
        }
        throw e
      }
    } else {
      // send message to eGain agent
      console.log(`${this.id} - sending message to ECE agent.`)
      try {
        await this.egainSession.SendMessageToAgent(message)
        console.log(`${this.id} - successfully sent message to ECE agent.`)
      } catch (e) {
        console.log(`${this.id} - failed to send message to ECE agent:`, e.message)
        // check for ETIMEDOUT errors
        if (e.message.indexOf('ETIMEDOUT') >=0) {
          // log to Teams
          teamsLogger.log(`${this.id} - timed out error - failed to send message to ECE agent in ${this.dcloudDatacenter} ${this.dcloudSession}: ${e.message}`)
        }
        throw e
      }
    }
  }

  async processCustomerMessage (text) {
    console.log(this.id, '- processing customer message:', text)
    const oldGcpId = this.gcpProjectId
    try {
      // figure out a response using AI
      const responses = await this.queryAi(text)
      // console.log(this.id, '- processCustomerMessage response =', response)
      // process the response text
      this.processAiResponse(responses[0].queryResult)
    } catch (e) {
      console.error(`${this.id} exception during processCustomerMessage`, e.message)
      // GCP credentials failed?
      if (e.message.indexOf('Could not load the default credentials.') >=0) {
        // load default credentials on this session and try again
        console.log(`${this.id} - failed to load credentials for GCP project ID ${this.gcpProjectId} - reverting to default.`)
        // set default GCP project ID
        this.gcpProjectId = process.env.GCP_PROJECT_ID
        // update credentials for this session
        await this.updateGcpCredentials()
        // retry now
        try {
          // figure out a response using AI
          const responses = await this.queryAi(text)
          // console.log(this.id, '- processCustomerMessage response =', response)
          // process the response text
          this.processAiResponse(responses[0].queryResult)
        } catch (e) {
          console.error(`${this.id} - failed again after loading default credentials:`, e.message)
          // send an error message to user
          this.addMessage('system', `There was an error loading the JSON ` +
            `credentials for your DialogFlow project ID ${oldGcpId}. I tried ` +
            `to load the default DialogFlow credentials, but there was ` +
            `another error: ${e.message}`)
        }
      }
    }
  }

  async queryAi (text) {
    console.log(this.id, '- querying dialogflow using project ID', this.gcpProjectId)

    // The dialogflow query body
    const req = {
      session: this.sessionPath,
      queryInput: {
        text: {
          // The query to send to the dialogflow agent
          text,
          // The language used by the client (en-US)
          languageCode: this.languageCode
        }
      }
    }

    // make sure the sessionClient exists
    if (!this.sessionClient) {
      // session client doesn't exist yet, so wait for the credentials promise
      // to finish
      await this.updateGcpCredentialsPromise
    }

    // Send request
    return this.sessionClient.detectIntent(req)
  }

  // get mobile app answers information
  async getAnswers (ani) {
    console.log(this.id, '- looking up answers for ani =', ani)
    const query = {
      ani: {
        $in: [
          ani,
          ani.replace(/^\+/, ''),
          this.email
        ]
      }
    }
    // ani starts with +1?
    if (ani.startsWith('+1')) {
      // also try without the +1 prefix
      query.ani.$in.push(ani.slice(2))
    }

    return db.findOne('cumulus', 'answers', query)
  }

  // check the dcloud session info using datacenter and session ID, and respond accordingly
  // also get user ID if not found
  async checkSessionInfo () {
    console.log(`${this.id} - checking dCloud session info...`)
    if (!this.dcloudDatacenter || !this.dcloudSession) {
      console.log(`${this.id} - dCloud session and datacenter are not set correctly. dcloudDatacenter = ${this.dcloudDatacenter} and dcloudSession = ${this.dcloudSession}`)
      // not set yet
      return false
    }
    try {
      console.log(`${this.id} - dCloud session and datacenter are set. Looking up session info from ${process.env.API_BASE}.`)
      let response = await this.getSessionInfo(this.userId)
      console.log(`${this.id} - found dCloud session and datacenter information for`, this.dcloudDatacenter, this.dcloudSession)
      // console.log('dcloud session response', response)

      // is this an instant demo session? (multi-user session)
      this.isInstantDemo = response.instant === true || response.instant === 'true'
      console.log(`${this.id} - instant demo = ${this.isInstantDemo}`)

      // make sure we have user ID
      if (!this.userId) {
        // get the instant demo customer (or register them if they are not registered)
        await this.checkInstantDemoCustomer()
        // get session info again now that we have user ID
        response = await this.getSessionInfo(this.userId)
      }
      // if (this.isInstantDemo && !this.userId) {
      //   // is instant demo, but user ID is unknown
      //   // we need to find user ID and then get demo configuration data again
      //   const answers = await this.getAnswers(this.phone)
      //   if (answers && answers.podId) {
      //     // Pod ID found - set to user ID
      //     this.userId = answers.podId
      //     console.log(this.id, '- user ID found in mobile app answers db:', this.userId)
      //     // get session info again
      //     response = await this.getSessionInfo(this.userId)
      //     console.log(`${this.id} - found dCloud session and datacenter information again for`, this.dcloudDatacenter, this.dcloudSession)
      //   } else {
      //     // user ID not found. sorry, gonna fail now
      //     console.log(this.id, '- could not find user ID in mobile app answers db')
      //     // tell user there was an error
      //     this.processCustomerMessage('dcloud-mobile-app-user-id-not-found')
      //   }
      // }

      // check if public address type is configured to use DNS
      if (process.env.PUBLIC_ADDRESS_TYPE.toLowerCase() === 'dns') {
        // use public DNS address of demo
        this.publicAddress = response.dns
      } else {
        // default to use public IP address of demo, to avoid DNS resolution
        this.publicAddress = response.publicIp
      }
      // is this the RCDN demo?
      if (this.dcloudDatacenter.toLowerCase() === 'rcdn') {
        // set egainHost to public DNS of demo vpod for escalating to ECE agent
        this.egainHost = `https://chat.cdxdemo.net/system`
      } else {
        // set egainHost to public DNS of demo vpod for escalating to ECE agent
        this.egainHost = `https://${this.publicAddress}/ece/system`
      }

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
      if (this.demoConfig.gcpProjectId) {
        this.gcpProjectId = this.demoConfig.gcpProjectId
        // trim whitespace off
        this.gcpProjectId = this.gcpProjectId.trim()
        console.log(this.id, '- used dCloud session config to update gcpProjectId to', this.gcpProjectId)
        this.updateGcpCredentialsPromise = this.updateGcpCredentials()
        await this.updateGcpCredentialsPromise
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
      // set UCCX chat CSQ ID for instant demos
      if (this.demoConfig.chatCsqId) {
        // prefix the ID with Chat_Csq_ for UCCX chat form to work
        this.csq = 'Chat_Csq' + this.demoConfig.chatCsqId
        console.log(this.id, '- used dCloud session config to update UCCX chat CSQ ID to', this.csq)
      }
      // set PCCE entry point IDs for instant demos
      if (this.demoConfig.entryPointId) {
        // prefix the ID with Chat_Csq_ for UCCX chat form to work
        this.entryPointId = this.demoConfig.entryPointId
        console.log(this.id, '- used dCloud session config to update PCCE ECE chat entry point ID', this.entryPointId)
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
      if (r2.gcpProjectId) {
        this.gcpProjectId = r2.gcpProjectId
        // trim whitespace off
        this.gcpProjectId = this.gcpProjectId.trim()
        console.log(this.id, '- used dCloud vertical config to update gcpProjectId to', this.gcpProjectId)
        this.updateGcpCredentialsPromise = await this.updateGcpCredentials()
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
      if (r2.surveys) {
        this.survey = r2.chatBotSurveyEnabled
        // vertical surveys configured?
        if (r2.surveys.digital) {
          // get survey questions
          this.surveyQuestions = [
            r2.surveys.digital.question1,
            r2.surveys.digital.question2
          ]
          // get survey greeting and goodbye phrases
          this.surveyGreeting = r2.surveys.digital.greeting
          this.surveyGoodbye = r2.surveys.digital.goodBye
          // turn on vertical survey instead of dialogflow survey
          this.useVerticalSurvey = true
          console.log(this.id, '- used dCloud vertical config to update survey to', this.survey)
        }
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
    return db.findOne('cumulus', 'vertical', {id: this.vertical}, {_id: 0})
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
    return db.findOne('toolbox', 'instance', query, {projection})
  }

  // register customer in instant demo
  async registerCustomer ({userId, contact}) {
    try {
      // try to push contact to existing customer record
      const result = await db.updateOne('toolbox', 'customer', {userId}, {$push: {contact}})
      if (result.matchedCount && result.modifiedCount) {
        console.log('customer', contact, 'registered to existing customer record for userId', userId)
      } else {
        console.log('registerCustomer updateOne failed. trying to find user', userId)
        // failed, so try to insert instead
        // find username
        const projection = {username: 1, firstName: 1, lastName: 1}
        const user = await db.findOne('toolbox', 'users', {id: userId}, {projection})
        if (!user) {
          throw Error('user ID ' + userId + ' not found.')
        }
        console.log('registerCustomer found user:', user)
        // set userId value
        user.userId = userId
        // upsert contact record into db
        console.log('registerCustomer creating customer for', user)
        const result2 = await db.upsert('toolbox', 'customer', {userId}, user)
        if (result.matchedCount && result.modifiedCount) {
          console.log('registerCustomer successfully created customer for', user)
        } else {
          console.log('registerCustomer failed to created customer for', user)
        }
      }
    } catch (e) {
      throw e
    }
  }

  // check if customer is registered to an instant demo user
  getCustomer () {
    const query = {
      contact: {
        $in: [
          this.phone,
          this.phone.replace(/^\+/, ''),
          this.email
        ]
      }
    }
    // phone number starts with +1?
    if (this.phone.startsWith('+1')) {
      // also try without the +1 prefix
      query.contact.$in.push(this.phone.slice(2))
    }
    return db.findOne('toolbox', 'customer', query)
  }

  async checkInstantDemoCustomer (aiMessage) {
    try {
      // is this an instant demo? then we might need to look up the
      // userId inside the demo session
      console.log(this.id, '- this is an instant demo. Checking user registration...')
      // find the customer in cloud db
      const customer = await this.getCustomer()
      if (customer) {
        // customer found
        // set user ID from customer info
        this.userId = customer.userId
        // log instant demo user ID
        console.log(this.id, '- instant demo - customer phone is already registered. Instant demo user ID is', this.userId, '. Continue with bot script.')
        // if aiMessage passed, start dialog with that message
        if (aiMessage) {
          return this.processCustomerMessage(aiMessage)
        } else {
          // done
          return
        }
      } else {
        // customer not found
        // not registered - ask customer to register
        console.log(this.id, 'instant demo - customer phone is not registered. Requesting that customer register now. Customer phone =', this.phone)
        // set session state to isRegistering
        this.isRegistering = true
        // send keyword to AI to send AI response to customer asking customer to register
        return this.processCustomerMessage('dcloud-user-register')
      }
    } catch (e) {
      throw e
    }
  }

  async processAiResponse (result) {
    console.log(this.id, '- processAiResponse - result.action =', result.action)
    console.log(this.id, '- processAiResponse - result.parameters =', result.parameters)
    try {
      const fulfillment = result.fulfillmentMessages
      const parameters = getDialogFlowV2Parameters(result)
      // check the api.ai response message and perform the associated action
      switch (result.action) {
        case 'datacenter': {
          if (fulfillment) {
            // add bot's reply to session's messages list
            for (const message of fulfillment) {
              this.addMessage('bot', message.text.text[0])
            }
          }
          // set datacenter
          this.dcloudDatacenter = parameters.dc
          // get session info now
          if (this.dcloudSession && this.dcloudDatacenter) {
            const valid = await this.checkSessionInfo()
            if (valid) {
              // check if we are isEscalating now or just showing instructions
              if (this.isEscalating) {
                // escalate
                this.escalate()
              } else if (!this.hasSentVerticalWelcome) {
                // send welcome message
                this.processCustomerMessage('sparky')
                this.hasSentVerticalWelcome = true
              }
            } else {
              // try to get info from customer again
              this.processCustomerMessage('wrong-information')
            }
          }
          break
        }
        case 'dcloud-session': {
          if (fulfillment) {
            // add bot's reply to session's messages list
            for (const message of fulfillment) {
              this.addMessage('bot', message.text.text[0])
            }
          }
          // set dcloud session ID
          this.dcloudSession = parameters.session
          // get session info now
          if (this.dcloudSession && this.dcloudDatacenter) {
            const valid = await this.checkSessionInfo()
            if (valid) {
              // check if we are isEscalating now or just showing instructions
              if (this.isEscalating) {
                // escalate
                this.escalate()
              } else if (!this.hasSentVerticalWelcome) {
                // send welcome message
                this.processCustomerMessage('sparky')
                this.hasSentVerticalWelcome = true
              }
            } else {
              // try to get info from customer again
              this.processCustomerMessage('wrong-information')
            }
          } else {
            // didn't get session info?
            // try to get info from customer again
            this.processCustomerMessage('wrong-information')
          }
          break
        }
        case 'escalate': {
          if (fulfillment) {
            // add bot's reply to session's messages list
            for (const message of fulfillment) {
              this.addMessage('bot', message.text.text[0])
            }
          }
          // escalate request to agent
          this.escalate()
          break
        }
        case 'start-video': {
          if (this.type === 'sparky-ui') {
            if (fulfillment) {
              // add bot's reply to session's messages list
              for (const message of fulfillment) {
                this.addMessage('bot', message.text.text[0])
              }
            }

            // start REM call
            this.addCommand('start-rem-video')
          } else {
            this.addMessage('bot', this.getLocalizedText('noVideo'))
          }
          break
        }
        case 'mortgage-calculator': {
          console.log(`${this.id} - sending mortgage-calculator command`)
          if (this.type === 'sparky-ui') {
            this.addMessage('bot', this.getLocalizedText('calculatorAppeared'))
            // open mortgage calculator
            this.addCommand('mortgage-calculator')
          } else {
            this.addMessage('bot', this.getLocalizedText('calculator') + ' ' + process.env.CALCULATOR_URL)
          }
          break
        }
        case 'survey-response': {
          // save the last survey answer
          this.surveyAnswers.push(parameters.surveyscore)
          if (fulfillment) {
            // add bot's reply to session's messages list
            for (const message of fulfillment) {
              this.addMessage('bot', message.text.text[0])
            }
          }
          break
        }
        case 'survey-end': {
          console.log(`${this.id} - ending survey and sending survey answers to demo now`)
          // save the last survey answer
          this.surveyAnswers.push(parameters.surveyscore)
          // out of survey now
          this.inSurvey = false
          // add bot's reply to session's messages list
          if (fulfillment) {
            // add bot's reply to session's messages list
            for (const message of fulfillment) {
              this.addMessage('bot', message.text.text[0])
            }
          }
          if (this.type !== 'sparky-ui') {
            // end of survey should end the session for bots other than sparky-ui
            // this.deescalate()
            this.endSession()
          }
          // send the survey results to the node service running in the demo
          await this.saveSurveyAnswers()

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
          if (fulfillment) {
            // add bot's reply to session's messages list
            for (const message of fulfillment) {
              this.addMessage('bot', message.text.text[0])
            }
          }
          console.log(this.id, '- sending change-brand-url command to UI with URL =', parameters.url)
          // send command to UI
          this.addCommand('change-brand-url', parameters.url)
          break
        }
        default: {
          if (fulfillment) {
            // add bot's reply to session's messages list
            for (const message of fulfillment) {
              try {
                this.addMessage('bot', message.text.text[0])
              } catch (e) {
                // ignore fulfillment messages without text that we can process
              }
            }
          }
          break
        }
      }
    } catch (e) {
      console.log(this.id, '- error during processAiResponse, and the result from DialogFlow was:', JSON.stringify(result, null, 2), 'and the error was:', e.message)
      // try to send the user a Teams message with this error, if instant demo user
      if (this.userId) {
        try {
          // find email address of instant demo user
          const projection = {email: 1}
          const user = await db.findOne('toolbox', 'users', {id: this.userId}, {projection})
          const toPersonEmail = user.email
          // make a file buffer from the result JSON
          const fileData = new Buffer.from(JSON.stringify(result, null, 2))
          // give it a filename
          const filename = 'dialgflow-response.json'
          // set content type to JSON
          const contentType = 'application/json'
          // write the message
          const markdown = `There was an error on the dCloud chat bot platform with vertical ${this.vertical} with GCP project ID ${this.gcpProjectId} - the last DialogFlow intent received didn't have response text defined. Attached is the DialogFlow response.`
          // send the message and file to teams
          await teams.message.send({
            toPersonEmail,
            roomType: 'direct',
            // roomId: undefined,
            // text: 'hi **you**',
            markdown,
            files: {
              value: fileData,
              options: {
                filename,
                contentType
              }
            }
          })
        } catch (e2) {
          console.log(this.id, '- failed to send DialogFlow response as a Teams message with file attachment:', e2.message)
        }
      }
    }
  }

  // save survey answers to database on the demo instance
  async saveSurveyAnswers () {
    try {
      const url = `${this.surveyHost}`
      // {answers: this.surveyAnswers}
      const body = {
        surveyId: process.env.SURVEY_ID,
        ani: this.phone,
        name: `${this.firstName} ${this.lastName}`,
        // only string answers are valid for db insert, not numbers
        q1: String(this.surveyAnswers[0] || '0'),
        q2: String(this.surveyAnswers[1] || '0')
      }
      const options = {
        // headers: {
        //   'Authorization': `Bearer ${token}`
        // }
      }
      const promise1 = axios.post(url, body, options)

      // also post survey answers to WXM cloud
      const promise2 = wxm.send(this)
      
      await Promise.all([promise1, promise2])
      console.log(this.id, '- saved survey answers')
    } catch (e) {
      console.log(this.id, '- failed to save survey answers:', e.message)
    }
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
    // try {
    //   console.log(`${this.id} - sending chat transcript...`)
    //   // send transcript if not RCDN
    //   if (this.dcloudDatacenter.toLowerCase() !== 'rcdn') {
    //     await transcript.send(this)
    //   }
    //   console.log(`${this.id} - transcript sent.`)
    // } catch (e) {
    //   console.log(`${this.id} - failed to send transcript:`, e.message)
    // }

    // generate transcript string
    let transcript = ''
    this.messages.forEach(message => {
      transcript += `${message.type}: ${message.text}\r\n`
    })

    if (this.demo && this.demo === 'uccx') {
      console.log(`${this.id} - Escalating to UCCX agent`)
      // escalate to SM on UCCX demo
      this.escalateToSocialMiner(transcript)
    } else {
      console.log(`${this.id} - Escalating to PCCE agent`)
      // default to PCCE
      this.escalateToEgain(transcript)
    }
  }

  async escalateToSocialMiner(message) {
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
      console.log(this.id, 'setting up uccx handlers...')
      const handlers = smEventHandlers.create(this)
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
        pollingInterval: 2000,
        handlers
      }
      console.log(this.id, 'uccx chat client initializing with data:', chatData)
      const uccx = new uccxChatClient(chatData)
      // save a reference to SocialMiner session
      this.smSession = uccx
      // start chat session
      try {
        await this.smSession.start()
      } catch (e) {
        console.log(this.id, '-', `UCCX chat failed to start for ${this.dcloudDatacenter} ${this.dcloudSession}:`, e.message)
        // log to Teams
        teamsLogger.log(`${this.id} - failed to start UCCX chat for ${this.dcloudDatacenter} ${this.dcloudSession}: ${e.message}`)
        throw e
      }
      // set escalated flag
      this.isEscalated = true
      // tell customer we are finding an agent by sending a message to DialogFlow for a response
      // this.addCustomerMessage('system', 'dcloud-finding-agent')
      // this.addMessage('system', localization[this.languageCode].welcomeMessage)
      // send the transcript as a customer message
      await this.sendEscalatedMessage(message)
    } catch (e) {
      console.error('error starting UCCX chat', e)
      // send an error message to user
      this.addMessage('system', `There was an error connecting to UCCX ` +
        `classic chat. It is no longer supported as of UCCX version 15. The ` +
        `error message was: ${e.message}`)
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
    console.log('escalating to ECE agent on entry point ID', this.entryPointId)
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
        this.addMessage('system', this.getLocalizedText('noAgentsAvailable'))
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
        this.addMessage('system', this.getLocalizedText('cannotAssignAgent'))
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

  async startSurvey () {
    console.log(this.id, '- starting post-chat survey by sending the chat bot the keyword "survey".')
    // egain session ended - now provide chat survey
    this.inSurvey = true

    // use vertical survey questions or dialogflow?
    if (this.useVerticalSurvey) {
      try {
        // send survey greeting from bot to user
        this.addMessage('bot', this.surveyGreeting)
        await sleep (1000)
        // ask first survey question
        this.surveyIndex = 0
        this.addMessage('bot', this.surveyQuestions[this.surveyIndex])
        // wait for first survey response
      } catch (e) {
        // TODO handle this
        console.log('error starting survey:', e)
      }
    } else {
      // dialogflow survey
      // start survey conversation by saying 'survey' to bot AI
      this.processCustomerMessage('survey')
    }

  }
}

module.exports = Session
