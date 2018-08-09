const express = require('express')
const router = express.Router()
// const axios = require('axios')
const crypto = require('crypto')
const spark = require('../spark')

// webex teams webhook receiver
router.post('/webhook', (req, res) => {
  console.log(`Cisco Webex Teams webhook event on webhook ID ${req.body.id}`, req.body, req.headers)
  if (validateRequest(req, process.env.TEAMS_PAYLOAD_SECRET)) {
    spark.handleWebhook(req.body).catch(e => console.error(e))
    return res.status(202).send()
  } else {
    return res.status(401).send()
  }
})

// validate Spark webhook events
function validateRequest (req, secret) {
  const signature = req.headers['x-spark-signature']
  const hash = crypto.createHmac('sha1', secret).update(JSON.stringify(req.body)).digest('hex')
  if (signature != hash) {
    console.error('WARNING: Webhook received message with invalid signature. Potential malicious behavior!')
    return false
  } else {
    return true
  }
}
module.exports = router
