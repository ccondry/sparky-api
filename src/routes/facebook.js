const express = require('express')
const router = express.Router()
const fb = require('../models/facebook')
const db = require('../models/db')
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
  return db.findOne('cumulus', 'facebook.page', {id})
}

// Accepts POST requests at /webhook endpoint for Facebook
router.post('/webhook', async function (req, res) {
  try {
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
          // should this message be forwarded?
          if (page.forward) {
            console.log('Forwarding Facebook webhook event to', page.forward)
            try {
              // forward the request to the url in database
              const instantResponse = await request({
                url: page.forward,
                method: 'POST',
                body: req.body,
                json: true,
                resolveWithFullResponse: true
              })
              // return the response from the destination server back to Facebook
              return res.status(instantResponse.statusCode).send(instantResponse.body)
            } catch (e) {
              console.error('Failed to forward Facebook webhook event to', page.forward, e.message)
              return res.status(500).send()
            }
          } else {
            // process locally
            // process each message, and wait for it
            try {
              await fb.handleMessage(message)
            } catch (e) {
              console.error('fb.handleMessage error:', e.message)
            }
          }
        }
      }
      // Return a '200 OK' response to all events
      return res.status(200).send('EVENT_RECEIVED')
    } else {
      console.log('this facebook webhook event is not from a Page. ignoring.')
      // Return a '200 OK'
      return res.status(200).send('EVENT_RECEIVED')
    }
  } catch (e) {
    console.error('Failed during processing of facebook webhook', e.message)
    return res.status(500).send()
  }
})

module.exports = router
