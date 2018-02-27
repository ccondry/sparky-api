const express = require('express')
const router = express.Router()
const fb = require('../facebook')
const Session = require('../session')
const sessions = require('../sessions')

/* For Facebook Validation */
router.get('/webhook', (req, res) => {
  console.log('Facebook validation request:', req.query)
  if (req.query['hub.mode'] && req.query['hub.verify_token'] === 'biamjack123') {
    res.status(200).send(req.query['hub.challenge'])
  } else {
    res.status(403).end()
  }
})

const facebookSessions = {}

function getFacebookSession (pageId, senderId) {
  try {
    return facebookSessions[pageId][senderId]
  } catch (e) {
    return null
  }
}

function addFacebookSession (pageId, senderId, session) {
  facebookSessions[pageId] = facebookSessions[pageId] || {}
  facebookSessions[pageId][senderId] = facebookSessions[pageId][senderId] || {}
  facebookSessions[pageId][senderId] = session
}

async function handleMessage (message) {
  // facebook user ID
  const userId = message.sender.id
  // facebook page ID
  const pageId = message.recipient.id
  // message text
  const messageText = message.message.text
  // message attachments
  const attachments = message.message.attachments
  // postbacks
  const postback = message.message.postback
  // get user info
  const fbUser = await fb.getSenderInfo(message.sender.id)
  // console.log('fbUser =', fbUser)
  const firstName = fbUser.first_name
  // console.log('firstName = ', firstName)
  const lastName = fbUser.last_name

  let session
  // find session, if exists
  session = getFacebookSession(message.recipient.id, message.sender.id)
  if (session === null) {
    console.log(`new facebook chat session for ${firstName} ${lastName}`)
    // new session
    // create session and store in sessions global
    session = new Session('facebook', {
      pageId,
      userId,
      phone: userId,
      email: userId,
      firstName,
      lastName
    })
    // add session to global Faceobook sessions
    addFacebookSession(session)
  }
  // was there text in the message?
  if (messageText) {
    // add message to session data
    session.addCustomerMessage(messageText)
  }
  // were there any attachments?
  if (attachments) {
    // process attachments to send to agent
    attachments.forEach(attachment => {
    // are we escalated to an eGain agent?
    if (session.isEscalated) {
      // send the file to the agent in eGain
      session.egainSession._sendCustomerAttachmentNotification(attachment.payload.url, `${session.firstName} ${session.lastName}`)
    } else {
      // was it just a sticker?
      if (attachment.payload.sticker_id) {
        // ignore stickers
        console.log(`${session.firstName} ${session.lastName} sent a Facebook sticker. Ignoring sticker.`)
        session.addMessage('customer', '(sticker)')
      } else {
        console.log(`${session.firstName} ${session.lastName} sent a file attachment.`)
        // note that user attached a file
        session.addMessage('customer', '(file attachment)')
        // just the bot here - let user know we can't do anything with them
        session.addMessage('bot', `I'm sorry, but I can't handle file attachments. If you would like to speak to an agent, say 'agent'.`)
      }
    }
  })
  }
  // was there a postback?
  if (postback) {
    // log postback details
    console.log(`Facebook postback for ${firstName} ${lastName}`, postback)
    // fb.handlePostback(userId, postback)
  }
}

// Accepts POST requests at /webhook endpoint for Facebook
router.post('/webhook', (req, res) => {
  // Parse the request body from the POST
  let body = req.body;
  console.log("Facebook webhook event:" + JSON.stringify(body))
  // Check the webhook event is from a Page subscription
  if (body.object === 'page') {
    // process potentially multiple webhook data entries from facebook
    body.entry.forEach(entry => {
      const pageId = entry.id // facebook page ID
      // process each message in the set
      entry.messaging.forEach(handleMessage)
    })
    // Return a '200 OK' response to all events
    res.status(200).send('EVENT_RECEIVED');
  }
})

module.exports = router
