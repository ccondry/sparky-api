const express = require('express')
const router = express.Router()

// Accepts POST requests at /webhook endpoint for Facebook
router.post('/webhook', (req, res) => {
  // Parse the request body from the POST
  let body = req.body;
  console.log("Incoming: " + JSON.stringify(body));
  // Check the webhook event is from a Page subscription
  if (body.object === 'page') {
    body.entry.forEach(function (entry) {
      // Gets the body of the webhook event
      let webhook_event = entry.messaging[0];
      // Get the sender PSID
      let sender_psid = webhook_event.sender.id;
      // Populate the Sender info
      let fbSender = getSenderInfo(sender_psid);
      var id = checkFBId(sender_psid);
      // Check if the event is a message or postback and
      // pass the event to the appropriate handler function
      if (webhook_event.message) {
        if(!inChat) {
          sendMessage(webhook_event);
        } else if(inChat && typeof(myChat !== 'undefined')) {
          // Check for the sending of an attachment
          if (webhook_event.message.attachments) {
            //handleMessage(sender_psid, webhook_event.message);
            //myChat.getFileData(webhook_event.message.attachments[0].payload.url);
            myChat._sendCustomerAttachmentNotification(webhook_event.message.attachments[0].payload.url, "Michael Littlefoot");
          } else {
            if (webhook_event.message.text === "goodbye") {
              myChat.End();
              inChat = false;
            } else {
              myChat.SendMessageToAgent(webhook_event.message.text);
            }
          }
        }
      } else if (webhook_event.postback) {
        handlePostback(sender_psid, webhook_event.postback)
      }
    })
    // Return a '200 OK' response to all events
    res.status(200).send('EVENT_RECEIVED');
  }
})

module.exports = router
