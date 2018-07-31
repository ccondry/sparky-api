const express = require('express')
const router = express.Router()
const fb = require('../facebook')
const db = require('../mongodb')
const request = require('request-promise-native')

/* For Facebook Validation */
router.get('/webhook', (req, res) => {
  console.log('Facebook validation request:', req.query)
  if (req.query['hub.mode'] && req.query['hub.verify_token'] === process.env.FACEBOOK_VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge'])
  } else {
    res.status(403).end()
  }
})

function findPage (id) {
  return db.findOne('facebook.pages', {id})
}

// Accepts POST requests at /webhook endpoint for Facebook
router.post('/webhook', async function (req, res) {
  // Parse the request body from the POST
  let body = req.body;
  console.log("Facebook webhook event:" + JSON.stringify(body))
  // Check the webhook event is from a Page subscription
  if (body.object === 'page') {
    // process potentially multiple webhook data entries from facebook
    for (let entry of body.entry) {
      // process each message in the set
      for (let message of entry.messaging) {
        // find page info in database
        const page = await findPage(message.recipient.id)
        // is this for the instant demo or scheduled demos?
        if (page.instantDemo) {
          // instant demo
          // forward the request to the instant demo public DNS address
          const instantResponse = await request({
            uri: process.env.PERSISTENT_DEMO_FACEBOOK_WEBHOOK,
            method: 'POST',
            body,
            resolveWithFullResponse: true
          }).then
          // don't process further messages - the instant demo server should
          // process them instead. Return its response to facebook.
          return res.status(instantResponse.statusCode).send(instantResponse.body)
        } else {
          // scheduled demo
          // process each message, and wait for it
          await fb.handleMessage(message).catch(e => console.error(e))
        }
      }
    }
    // Return a '200 OK' response to all events
    return res.status(200).send('EVENT_RECEIVED');
  } else {
    console.log('this facebook webhook event is not from a Page. ignoring.')
    // Return a '200 OK'
    return res.status(200).send('EVENT_RECEIVED');
  }
})

module.exports = router
