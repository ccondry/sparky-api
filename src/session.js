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

    if (type === 'sparky-ui') {
      // sparky-ui chat client
      // get api.ai token
      this.type = 'sparky-ui'
      this.visitId = data.visitId
    } else if (type === 'facebook') {
      // facebook chat client
      this.type = 'facebook'
      this.page = data.page
      // this.apiAiToken = data.page.aiToken || process.env.APIAI_TOKEN
      // this.entryPointId = data.page.entryPointId || '1001'

      this.pageId = data.page.id
      this.userId = data.userId
      // try to get email address and phone number from CXDemo
      // this.getDemoUserData().catch(e => {})
    } else {
      this.type = data.type
      this.data = data
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
    // end ECE session
    this.egainSession.End()
    // remove escalated flag
    this.isEscalated = false
    // delete the messages in memory so that new transcripts are only the latest
    this.messages = []
    if (this.onDeescalate && typeof this.onDeescalate === 'function') {
      this.onDeescalate.call(this)
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
      // check for command words
      switch (message.toLowerCase()) {
        case 'goodbye': {
          // tell user session ended
          this.addMessage('system', 'Your session with our expert has ended, but you can still chat with Sparky.')
          // end eGain session
          this.deescalate()
          break
        }
      }
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
        if (this.type === 'sparky-ui') {
          // make REM video call
          this.addCommand('start-rem-video')
        } else {
          this.addMessage('bot', `I'm sorry, I'm not able to connect a video call to you from here.`)
        }
        break
      }
      case 'calculator': {
        if (this.type === 'sparky-ui') {
          this.addMessage('bot', 'Ok... Your calculator should have appeared on the left!')
          // open mortgage calculator
          this.addCommand('mortgage-calculator')
        } else {
          this.addMessage('bot', 'Here is our mortgage calculator: http://static.cxdemo.net/documents/sparky/calculator.html')
        }
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
    transcript.send(this).catch(e => {})
    console.log('escalate session:', this)
    // build customer object for connection to eGain
    const customerObject = require('./egainCustomer').create({
      firstName: this.firstName,
      lastName: this.lastName,
      email: this.email,
      phone: this.phone
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
