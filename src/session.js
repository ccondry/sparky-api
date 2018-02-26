const uuidv1 = require('uuid/v1')
const myLibrary = require('./egainLibrary.js')
const request = require('request-promise-native')
const egainEventHandlers = require('./egainEventHandlers')
const transcript = require('./transcript')

// predefined named chat bot tokens
const tokens = {
  'cumulus-finance': '1c4d3b458b3f4109bec0b38f792cfc46',
  'sparky-retail': 'a2083e974dc84b599e86124fca44a9e3'
}

class Session {
  constructor (type, data) {
    if (type === 'sparky-ui') {
      // get api.ai token
      const apiAiToken = data.apiAiToken || tokens[data.bot] || '1c4d3b458b3f4109bec0b38f792cfc46'

      // sparky-ui chat bot client
      this.id = uuidv1()
      this.type = 'sparky-ui'
      this.state = 'active'
      this.messages = []
      this.entryPointId = data.entryPointId || '1001'
      this.phone = data.phone
      this.email = data.email
      this.firstName = data.firstName
      this.lastName = data.lastName
      this.apiAiToken = apiAiToken
      this.visitId = data.visitId
      this.language = data.language || 'en'
    }
  }

  // add new message to session
  addMessage (type, message) {
    // push message to array
    this.messages.push({
      text: message,
      type,
      datetime: new Date().toJSON()
    })
    // TODO if facebook client, send the message to facebook
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
    // end ECE session
    this.egainSession.End()
    // remove escalated flag
    this.escalated = false
  }

  addCustomerMessage (message) {
    // add message to memory
    this.addMessage('customer', message)
    // is this chat escalated to an agent?
    if (this.escalated) {
      // send message to eGain agent
      this.egainSession.SendMessageToAgent(message)
      // check for command words
      switch (message) {
        case 'goodbye': {
          // tell user session ended
          this.addMessage('system', 'Your session with our expert has ended, but you can still chat with Sparky.')
          // end eGain session
          this.deescalate()
          break
        }
      }
    } else {
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
      this.processAiResponse(response.result.fulfillment)

    } catch (e) {
      console.error('exception during processCustomerMessage', e)
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

  processAiResponse (fulfillment) {
    // TODO use intents instead of speech response for commands
    const text = fulfillment.speech
    // check the api.ai response message and perform the associated action
    switch (text) {
      case 'escalate': {
        // escalate request to agent
        this.escalate()
        break
      }
      case 'video': {
        // make REM video call
        this.addCommand('start-rem-video')
        break
      }
      case 'calculator': {
        this.addMessage('bot', 'Ok... Your calculator should have appeared on the left!')
        // open mortgage calculator
        this.addCommand('mortgage-calculator')
        break
      }
      default: {
        // add bot's reply to session's messages list
        this.addMessage('bot', text)
        break
      }
    }
  }

  escalate () {
    // send the chat transcript to Context Service
    transcript.send(this)

    const customerObject = require('./egainCustomer').create({
      firstName: this.firstName,
      lastName: this.lastName,
      email: this.email,
      phone: this.phone,
      visitId: this.visitId
    })

    try {
      // create instance of ECE chat object
      const myChat = new myLibrary.Chat();
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
      this.escalated = true
    } catch (e) {
      console.error('error starting ECE chat', e)
    }
  }
}

module.exports = Session
