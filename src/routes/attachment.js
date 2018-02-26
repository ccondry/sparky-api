const express = require('express')
const router = express.Router()
const sessions = require('../sessions')

router.post('/', (req, res) => {
  // no session?
  // if(!inChat) {
  //   sendMessage(webhook_event)
  // } else if(inChat && typeof(myChat !== 'undefined')) {
  //   // Check for the sending of an attachment
  //   if(webhook_event.message.attachments) {
  //     //handleMessage(sender_psid, webhook_event.message);
  //     //myChat.getFileData(webhook_event.message.attachments[0].payload.url);
  //     // send attachment notification to ECE, to send to the agent
  //     myChat._sendCustomerAttachmentNotification(webhook_event.message.attachments[0].payload.url, "Michael Littlefoot")
  //   } else if (webhook_event.message.text === "goodbye") {
  //     // did the customer want to end the agent chat interaction?
  //     // end ECE chat
  //     myChat.End()
  //     // end session
  //     inChat = false
  //   } else {
  //     // send the message text to the agent
  //     myChat.SendMessageToAgent(webhook_event.message.text)
  //   }
  // }
})

module.exports = router
