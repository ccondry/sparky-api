const uuidv1 = require('uuid/v1')
const egainLibrary = require('./egainLibrary.js')
const request = require('request-promise-native')
const egainEventHandlers = require('./egainEventHandlers')
const transcript = require('./transcript')
const axios = require('axios')
const util = require('util')
const uccxChatClient = require('uccx-chat-client')
const smEventHandlers = require('./smEventHandlers')

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
    this.firstName = data.firstName
    this.lastName = data.lastName
    this.language = data.language || process.env.DEFAULT_LANGUAGE || 'en'
    // run this callback at de-escalation time
    this.removeSession = data.removeSession
    // run this callback when messages are added
    this.onAddMessage = data.onAddMessage
    // resolve this promise to get user data
    // this.getCustomerData = data.getCustomerData
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
    // console.log(`creating ${this.type} Sparky session ${this.id}: for ${this.firstName} ${this.lastName} with AI token ${this.apiAiToken} for entry point ${this.entryPointId} and survey is ${this.data.survey ? 'enabled' : 'disabled'}`)
    const logData = JSON.parse(JSON.stringify(this))
    console.log(`${this.id} - new ${this.type} session created for ${this.email}`)
    // create survey answers array
    this.surveyAnswers = []
  }

  checkExpiration () {
    // did session expire?
    if (new Date().getTime() > this.expiry) {
      console.log(`${this.id} - session is old and has expired. Informing user about it and remove this session.`)
      // TODO update this message
      this.addMessage('bot', process.env.MESSAGE_SESSION_EXPIRED)
      //remove session from sessions
      this.endSession()
    }
  }

  resetExpiration () {
    // reset expiry to current time + configured timeout value
    this.expiry = new Date().getTime() + 1000 * process.env.SESSION_TIMEOUT
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
    if (this.data.survey) {
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
      this.escalate(message)
    } else {
      // console.log('getting bot response...')
      // let bot handle the response
      this.processCustomerMessage(message)
    }
  }

  sendEscalatedMessage (message) {
    if (this.demo && this.demo.toLowerCase() === 'uccx') {
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
      console.log(`${this.id} - dCloud session and datacenter are set. Looking up session info from mm.cxdemo.net.`)
      const response = await this.getSessionInfo()
      console.log(`${this.id} - found dCloud session and datacenter information`)
      // console.log('dcloud session response', response)
      // set egainHost to public DNS of demo vpod for escalating to ECE agent
      this.egainHost = `https://${response.dns}/ece/system`
      console.log(`${this.id} - egainHost = ${this.egainHost}`)
      // set csHost to public DNS of demo vpod for transcript
      this.csHost = `https://${response.dns}/cs`
      console.log(`${this.id} - csHost = ${this.csHost}`)
      this.csBackupHost = `https://${response.dns}/cs2`
      console.log(`${this.id} - csBackupHost = ${this.csBackupHost}`)
      this.smHost = `https://${response.dns}/ccp`
      console.log(`${this.id} - smHost = ${this.smHost}`)
      this.demo = response.demo
      console.log(`${this.id} - demo = ${this.demo}`)
      this.demoVersion = response.version
      console.log(`${this.id} - demo version = ${this.demoVersion}`)
      // set surveyHost to public DNS of demo vpod for saving survey answers
      this.surveyHost = `https://${response.dns}/survey`
      return true
    } catch (e) {
      console.error(`${this.id} - error getting dcloud session info for ${this.dcloudDatacenter} ${this.dcloudSession}`, e.message)
      // reset the session info to null
      this.dcloudDatacenter = null
      this.dcloudSession = null
      return false
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
          this.addMessage('bot', `I'm sorry, I'm not able to connect a video call to you from here.`)
        }
        break
      }
      case 'mortgage-calculator': {
        console.log(`${this.id} - sending mortgage-calculator command`)
        if (this.type === 'sparky-ui') {
          this.addMessage('bot', 'Ok... Your calculator should have appeared on the left!')
          // open mortgage calculator
          this.addCommand('mortgage-calculator')
        } else {
          this.addMessage('bot', 'Here is our mortgage calculator: ' + process.env.CALCULATOR_URL)
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

    if (this.demo && this.demo.toLowerCase() === 'uccx') {
      // escalate to SM on UCCX demo
      this.escalateToSocialMiner(message)
    } else {
      // default to PCCE
      this.escalateToEgain(message)
    }
  }

  escalateToSocialMiner(message) {
    console.log(`${this.id} - escalating to SocialMiner agent`)

    // set up UCCX chat system
    try {
      console.log(this.id, 'setting up uccx chat client to', this.smHost, '...')
      const uccx = new uccxChatClient({
        urlBase: this.smHost,
        form: process.env.UCCX_CHAT_FORM_ID,
        csq: process.env.UCCX_CHAT_CSQ,
        title: 'Facebook Messenger',
        customerName: `${this.firstName} ${this.lastName}`,
        author: `${this.firstName} ${this.lastName}`,
        customerEmail: this.email,
        customerPhone: this.phone
      })
      console.log(this.id, 'uccx chat client created. setting up handlers...')
      uccx.setHandlers(smEventHandlers.create(uccx, this))
      console.log(this.id, 'uccx chat handlers set up.')
      // save a reference to SocialMiner session
      this.smSession = uccx
      // start chat session
      this.smSession.start()
      // set escalated flag
      this.isEscalated = true
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
      subject: message
      // visitId: this.visitId
    })

    try {
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
    this.deescalate()
  }

  onEgainFail (args) {
    switch (args.StatusMessage) {
      case 'L10N_NO_AGENTS_AVAILABLE': {
        // tell customer that there are no agents available
        this.addMessage('system', process.env.MESSAGE_SYSTEM_NO_AGENTS_AVAILABLE)
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
