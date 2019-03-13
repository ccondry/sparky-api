const express = require('express')
const router = express.Router()
const whatsapp = require('../models/whatsapp')

// Whatsapp webhooks from Twilio
router.post('/webhook', (req, res) => {
  const message = req.body.Body
  const to = req.body.To
  const from = req.body.From

  whatsapp.handleMessage(req.body)
  .then((value) => {
    return res.status(201).send()
  })
  .catch(e => console.error(e))
})

// Whatsapp message delivery status from Twilio
router.post('/status', (req, res) => {
  console.log('WhatsApp message delivery status from Twilio:', req.body)
})

module.exports = router
