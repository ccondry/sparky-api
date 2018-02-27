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
      entry.messaging.forEach(async (message) => {
        // facebook user ID
        const userId = message.sender.id
        // facebook page ID
        const pageId = message.recipient.id
        // message text
        const messageText = message.message.text
        // get user info
        const fbUser = await fb.getSenderInfo(message.sender.id)
        // console.log('fbUser =', fbUser)
        const firstName = fbUser.first_name
        // console.log('firstName = ', firstName)
        const lastName = fbUser.last_name
        // find session, if exists
        const session = getFacebookSession(message.recipient.id, message.sender.id)
        if (session !== null) {
          // existing session
          // add message to session data
          session.addCustomerMessage(messageText)
        } else {
          console.log(`new facebook chat session for ${firstName} ${lastName}`)
          // new session
          // create session and store in sessions global
          const session = new Session('facebook', {
            pageId,
            userId,
            phone: userId,
            email: userId,
            firstName,
            lastName
          })
          // store session in global sessions
          // sessions[session.id] = session
          // add session to global Faceobook sessions
          addFacebookSession(session)
          // add first message
          session.addCustomerMessage(messageText)
        }
      })
      // Check if the event is a message or postback and
      // pass the event to the appropriate handler function
      // if (webhook_event.message) {
      //   if(!inChat) {
      //     fb.sendMessage(webhook_event);
      //   } else if(inChat && typeof(myChat !== 'undefined')) {
      //     // Check for the sending of an attachment
      //     if (webhook_event.message.attachments) {
      //       //handleMessage(sender_psid, webhook_event.message);
      //       //myChat.getFileData(webhook_event.message.attachments[0].payload.url);
      //       myChat._sendCustomerAttachmentNotification(webhook_event.message.attachments[0].payload.url, "Michael Littlefoot");
      //     } else {
      //       if (webhook_event.message.text === "goodbye") {
      //         myChat.End();
      //         inChat = false;
      //       } else {
      //         myChat.SendMessageToAgent(webhook_event.message.text);
      //       }
      //     }
      //   }
      // } else if (webhook_event.postback) {
      //   fb.handlePostback(sender_psid, webhook_event.postback)
      // }
    })
    // Return a '200 OK' response to all events
    res.status(200).send('EVENT_RECEIVED');
  }
})

module.exports = router
