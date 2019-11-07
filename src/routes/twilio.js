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
  // req.body example:
  // { SmsSid: 'SMae82cde916474ef89842517a603f61ff',
  //   SmsStatus: 'sent',
  //   MessageStatus: 'sent',
  //   ChannelToAddress: '+12142336226',
  //   To: 'sms:+12142336226',
  //   ChannelPrefix: 'sms',
  //   MessageSid: 'SMae82cde916474ef89842517a603f61ff',
  //   AccountSid: 'ACe3d0534adf95b3e4f7e44e76c805dea7',
  //   StructuredMessage: 'false',
  //   From: 'sms:+14155238886',
  //   ApiVersion: '2010-04-01',
  //   ChannelInstallSid: 'XEcc20d939f803ee381f2442185d0d5dc5' }
  const b = req.body
  const from = message.From.split('sms:').pop()
  const to = message.To.split('sms:').pop()
  const message = `${b.SmsStatus} from ${from} to ${to}`
  console.log(`SMS message delivery status from Twilio:`, message)
})

module.exports = router
