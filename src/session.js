const uuidv1 = require('uuid/v1')
const myLibrary = require('./egainLibrary.js')
const request = require('request-promise-native')
const egainEventHandlers = require('./egainEventHandlers')
const transcript = require('./transcript')

class Session {
  constructor (type, data) {
    this.id = uuidv1()
    this.state = 'active'
    this.isEscalated = false
    this.messages = []
    this.phone = data.phone
    this.email = data.email
    this.firstName = data.firstName
    this.lastName = data.lastName
    this.language = data.language || 'en'
    // run this callback at de-escalation time
    this.onDeescalate = data.onDeescalate
    // run this callback when messages are added
    this.onAddMessage = data.onAddMessage
    // resolve this promise to get user data
    this.getCustomerData = data.getCustomerData
    this.apiAiToken = data.apiAiToken || process.env.APIAI_TOKEN

    this.entryPointId = data.entryPointId || process.env.FACEBOOK_ENTRY_POINT_ID

    if (data.botEnabled === false) {
      this.botEnabled = false
    } else {
      this.botEnabled = true
    }
    this.type = type
    this.data = data
    console.log(`creating ${this.type} Sparky session ${this.id} for ${this.firstName} ${this.lastName} with AI token ${this.apiAiToken} for entry point ${this.entryPointId}`)
  }

  // add new message to session
  addMessage (type, message) {
    // push message to array
    this.messages.push({
      text: message,
      type,
      datetime: new Date().toJSON()
    })
    // if this is a bot/system/agent message, send it to the customer on facebook
    if (type !== 'customer' && this.onAddMessage && typeof this.onAddMessage === 'function') {
      this.onAddMessage.call(this, type, message)
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
    this.messages = []
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
    // check for command words
    switch (message.toLowerCase()) {
      case 'goodbye': {
        // tell user session ended
        // this.addMessage('system', 'Your session with our expert has ended, but you can still chat with Sparky.')
        // end session
        this.deescalate()
        break
      }
    }
  }

  async processCustomerMessage (text) {
    try {
      // figure out a response using AI
      const response = await this.queryAi(text)
      console.log('processCustomerMessage response =', response)
      // process the response text
      this.processAiResponse(response.result)

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

  processAiResponse (result) {
    const fulfillment = result.fulfillment
    // check the api.ai response message and perform the associated action
    switch (result.action) {
      case 'escalate': {
        if (fulfillment.speech !== 'escalate') {
          this.addMessage('bot', fulfillment.speech)
        }
        // escalate request to agent
        this.escalate()
        break
      }
      case 'start_video': {
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
            this.addMessage('bot', 'Here is our mortgage calculator: http://static.cxdemo.net/documents/sparky/calculator.html')
          } else {
            this.addMessage('bot', fulfillment.speech)
          }
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

  escalate (message) {
    // send the chat transcript to Context Service
    transcript.send(this).catch(e => {})
    // console.log('escalate session:', this)
    // build customer object for connection to eGain
    const customerObject = require('./egainCustomer').create({
      firstName: this.firstName,
      lastName: this.lastName,
      email: this.email,
      phone: this.phone,
      subject: message
      // visitId: this.visitId
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
      this.isEscalated = true
    } catch (e) {
      console.error('error starting ECE chat', e)
    }
  }
}

module.exports = Session
