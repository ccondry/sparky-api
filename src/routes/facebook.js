const express = require('express')
const router = express.Router()
const fb = require('../facebook')

/* For Facebook Validation */
router.get('/webhook', (req, res) => {
  console.log('Facebook validation request:', req.query)
  if (req.query['hub.mode'] && req.query['hub.verify_token'] === process.env.FACEBOOK_VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge'])
  } else {
    res.status(403).end()
  }
})

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
      entry.messaging.forEach(message => {
        fb.handleMessage(message).catch(e => console.error(e))
      })
    })
    // Return a '200 OK' response to all events
    res.status(200).send('EVENT_RECEIVED');
  } else {
    console.log('this facebook webhook event is not from a Page. ignoring.')
  }
})

module.exports = router
