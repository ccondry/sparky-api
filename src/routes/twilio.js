const express = require('express')
const router = express.Router()
const twilio = require('../twilio')

// SMS webhooks from twilio
router.post('/', (req, res) => {
  // console.log("Twilio webhook event:" + JSON.stringify(req.body))
  const message = req.body.Body
  const to = req.body.To
  const from = req.body.From
  twilio.handleMessage(req.body).catch(e => console.error(e))
  res.status(201).send()
})

module.exports = router
