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
  // req.body example:
  // { SmsSid: 'SMae82cde916474ef89842517a603f61ff',
  //   SmsStatus: 'sent',
  //   MessageStatus: 'sent',
  //   ChannelToAddress: '+12142336226',
  //   To: 'whatsapp:+12142336226',
  //   ChannelPrefix: 'whatsapp',
  //   MessageSid: 'SMae82cde916474ef89842517a603f61ff',
  //   AccountSid: 'ACe3d0534adf95b3e4f7e44e76c805dea7',
  //   StructuredMessage: 'false',
  //   From: 'whatsapp:+14155238886',
  //   ApiVersion: '2010-04-01',
  //   ChannelInstallSid: 'XEcc20d939f803ee381f2442185d0d5dc5' }
  const b = req.body
  const from = b.From.split('whatsapp:').pop()
  const to = b.To.split('whatsapp:').pop()
  const message = `${b.SmsStatus} from ${from} to ${to}`
  console.log(`WhatsApp message delivery status from Twilio:`, message)
})

module.exports = router
