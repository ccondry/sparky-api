const express = require('express')
const router = express.Router()
const twilio = require('../twilio')

// Accepts POST requests at /webhook endpoint for Facebook
router.post('/', (req, res) => {
  // console.log("Twilio webhook event:" + JSON.stringify(req.body))
  const message = req.body.Body
  const to = req.body.To
  const from = req.body.From
  twilio.handleMessage(req.body).catch(e => console.error(e))
})

module.exports = router