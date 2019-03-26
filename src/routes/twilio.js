const express = require('express')
const router = express.Router()
const twilio = require('../models/twilio')

// SMS webhooks from twilio
router.post('/', (req, res) => {
  // console.log("Twilio webhook event:" + JSON.stringify(req.body))
  const message = req.body.Body
  const to = req.body.To
  const from = req.body.From
  twilio.handleMessage(req.body).catch(e => console.error(e))
  res.status(201).send()
})

// SMS message delivery status from Twilio
router.post('/status', (req, res) => {
  console.log('SMS message delivery status from Twilio:', req.body)
})

module.exports = router
