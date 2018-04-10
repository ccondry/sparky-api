const uuidv1 = require('uuid/v1')
const egainLibrary = require('./egainLibrary.js')
const request = require('request-promise-native')
const egainEventHandlers = require('./egainEventHandlers')
const transcript = require('./transcript')

class Session {
  constructor (type, data) {
    this.id = uuidv1()
    this.state = 'active'
    this.inSurvey = false
    this.isEscalated = false
    this.messages = []
    this.phone = data.phone
    this.email = data.email
    this.firstName = data.firstName
    this.lastName = data.lastName
    this.language = data.language || process.env.DEFAULT_LANGUAGE || 'en'
    // run this callback at de-escalation time
    this.onDeescalate = data.onDeescalate
    // run this callback when messages are added
    this.onAddMessage = data.onAddMessage
    // resolve this promise to get user data
    this.getCustomerData = data.getCustomerData
    // this.apiAiToken = data.apiAiToken || process.env.API_AI_TOKEN
    // just use the one static token
    this.apiAiToken = process.env.API_AI_TOKEN

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
    if (this.dcloudSession && this.dcloudDatacenter) {
      // check if session is valid, and get the session info
      // this.egainHost = `https://${this.dcloudDatacenter.toLowerCase()}-${this.dcloudSession}.localtunnel.me/system`
      // this.egainHost = `http://pcce.vpod438.dc-01.com/ece/system`
      // this.egainHost = `https://cceece.dcloud.cisco.com/system`
      this.egainHost = null
      this.getSessionInfo()
      .then(response => {
        // console.log('dcloud session response', response)
        // set egainHost to public DNS of demo vpod
        this.egainHost = `https://${response.dns}/ece/system`
        console.log('egainHost = ', this.egainHost)
      })
      .catch(e => {
        console.error(`error getting dcloud session info for ${this.dcloudDatacenter} ${this.dcloudSession}`, e)
      })
    } else {
      // egainHost null by default
      this.egainHost = null
      // this.egainHost = `http://pcce.vpod438.dc-01.com/ece/system`
    }
    // console.log(`creating ${this.type} Sparky session ${this.id}: for ${this.firstName} ${this.lastName} with AI token ${this.apiAiToken} for entry point ${this.entryPointId} and survey is ${this.data.survey ? 'enabled' : 'disabled'}`)
    const logData = JSON.parse(JSON.stringify(this))
    console.log(`creating ${this.type} Sparky session:`, logData)
  }

  // get dCloud session information
  getSessionInfo () {
    return request({
      method: 'GET',
      url: `https://mm.cxdemo.net/api/v1/datacenters/${this.dcloudDatacenter.toUpperCase()}/sessions/${this.dcloudSession}`,
      json: true
    })
  }

  // add new message to session
  addMessage (type, message) {
    // if message is not empty string
    if (message.length) {
      // push message to array
      this.messages.push({
        text: message,
        type,
        datetime: new Date().toJSON()
      })
      // if this is a bot/system/agent message, send it to the customer on facebook
      if (type !== 'customer') {
        // match the Incoming log message format
        console.log('Outgoing:', JSON.stringify({text: message, sessionId: this.id}))
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
      this.egainSession.End()
    }
    // remove escalated flag
    this.isEscalated = false
    // delete the messages in memory so that new transcripts are only the latest
    // this.messages = []
    // call custom deescalate handler
    if (this.onDeescalate && typeof this.onDeescalate === 'function') {
      console.log('calling deescalate handler')
      this.onDeescalate.call(this)
    } else {
      console.log('onDeescalate not a function. onDeescalate =', this.onDeescalate)
    }
  }

  addCustomerMessage (message) {
    // add message to memory
    this.addMessage('customer', message)
    if (message.toLowerCase() === 'goodbye') {
      // end session
      this.deescalate()
    }
    // is this chat escalated to an agent?
    if (this.isEscalated) {
      console.log('this chat is escalated already. sending message to ECE agent.')
      // send message to eGain agent
      this.egainSession.SendMessageToAgent(message)
    } else if (this.botEnabled === false) {
      // if bot disabled, escalate directly to an agent
      this.escalate(message)
    } else {
      // console.log('getting bot response...')
      // let bot handle the response
      this.processCustomerMessage(message)
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
      console.error('exception during processCustomerMessage', e.message)
    }
  }

  queryAi (text) {
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

  processAiResponse (result) {
    const fulfillment = result.fulfillment
    // check the api.ai response message and perform the associated action
    console.log('ai response', result)
    switch (result.action) {
      case 'datacenter': {
        if (fulfillment.speech.length) {
          this.addMessage('bot', fulfillment.speech)
        }
        // set datacenter
        this.dcloudDatacenter = result.parameters.dc
        // get session info now
        if (this.dcloudSession && this.dcloudDatacenter) {
          this.getSessionInfo()
          .then(response => {
            // console.log('dcloud session response', response)
            // set egainHost to public DNS of demo vpod
            this.egainHost = `https://${response.dns}/ece/system`
            console.log('egainHost = ', this.egainHost)
          })
          .catch(e => {
            console.error(`error getting dcloud session info for ${this.dcloudDatacenter} ${this.dcloudSession}`, e)
          })
        }
        break
      }
      case 'dcloud-session': {
        // console.log('ai response', result)
        if (fulfillment.speech.length) {
          this.addMessage('bot', fulfillment.speech)
        }
        // set dcloud session ID
        this.dcloudSession = result.parameters.session
        // get session info now
        if (this.dcloudSession && this.dcloudDatacenter) {
          this.getSessionInfo()
          .then(response => {
            // console.log('dcloud session response', response)
            // set egainHost to public DNS of demo vpod
            this.egainHost = `https://${response.dns}/ece/system`
            console.log('egainHost = ', this.egainHost)
          })
          .catch(e => {
            console.error(`error getting dcloud session info for ${this.dcloudDatacenter} ${this.dcloudSession}`, e)
          })
        }
        break
      }
      case 'escalate': {
        if (fulfillment.speech !== 'escalate' && fulfillment.speech.length) {
          this.addMessage('bot', fulfillment.speech)
        }
        // escalate request to agent
        this.escalate()
        break
      }
      case 'start-video': {
        if (this.type === 'sparky-ui') {
          // make REM video call
          if (fulfillment.speech !== 'video') {
            this.addMessage('bot', fulfillment.speech)
          }
          this.addCommand('start-rem-video')
        } else {
          this.addMessage('bot', `I'm sorry, I'm not able to connect a video call to you from here.`)
        }
        break
      }
      case 'mortgage-calculator': {
        if (this.type === 'sparky-ui') {
          if (fulfillment.speech === 'calculator') {
            this.addMessage('bot', 'Ok... Your calculator should have appeared on the left!')
          } else {
            this.addMessage('bot', fulfillment.speech)
          }
          console.log('sending mortgage-calculator command')
          // open mortgage calculator
          this.addCommand('mortgage-calculator')
        } else {
          if (fulfillment.speech === 'calculator') {
            this.addMessage('bot', 'Here is our mortgage calculator: ' + process.env.CALCULATOR_URL)
          } else {
            this.addMessage('bot', fulfillment.speech)
          }
        }
        break
      }
      case 'survey-end': {
        this.inSurvey = false
        // say last bot message and then end session
        this.addMessage('bot', fulfillment.speech)
        if (this.type !== 'sparky-ui') {
          // end of survey should end the session for bots other than sparky-ui
          this.deescalate()
        }
        break
      }
      case 'start-survey': {
        this.startSurvey()
        break
      }
      case 'end-session': {
        // end session
        if (this.data.survey) {
          this.startSurvey()
        } else {
          // survey not enabled - just go to deescalate
          this.deescalate()
        }
        break
      }
      default: {
        // add bot's reply to session's messages list
        this.addMessage('bot', fulfillment.speech)
        break
      }
    }
  }

  async escalate (message) {
    // send the chat transcript to Context Service
    transcript.send(this).catch(e => {})
    // console.log('escalate session:', this)
    // build customer object for connection to eGain
    const customerObject = require('./egainCustomer').create({
      egainHost: this.egainHost,
      firstName: this.firstName,
      lastName: this.lastName,
      email: this.email,
      phone: this.phone,
      subject: message
      // visitId: this.visitId
    })

    try {
      if (!this.egainHost) {
        // wait for whatever operations necessary to get egain host
        // TODO implement chat questions to get datacenter info if not available
        // await this.getEgainHost()
        throw 'No eGain host was set.'
      }
      const myLibrary = egainLibrary.get(this.egainHost)
      // create instance of ECE chat object
      const myChat = new myLibrary.Chat()
      // build ECE chat event handlers
      const myEventHandlers = egainEventHandlers.create(myChat, this)
      // init the ECE chat object
      myChat.Initialize(this.entryPointId, this.language, 'US', myEventHandlers, 'aqua', 'v11')
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
    // survey enabled for this bot?
    console.log('this.data.survey = ', this.data.survey)
    if (this.data.survey) {
      // set escalated flag to false
      this.isEscalated = false
      this.startSurvey()
    } else {
      // survey not enabled - just go to deescalate
      this.deescalate()
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
