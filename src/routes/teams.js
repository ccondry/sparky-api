const express = require('express')
const router = express.Router()
// const axios = require('axios')
const crypto = require('crypto')
const spark = require('../spark')

// webex teams webhook receiver
router.post('/webhook', async (req, res) => {
  console.log(`Webex Teams webhook event:`, req.body)
  if (validateRequest(req, process.env.TEAMS_PAYLOAD_SECRET)) {
    console.log('Webex Teams webhook event validated.')
    try {
      await spark.handleWebhook(req.body).catch(e => console.error(e))
      return res.status(202).send()
    } catch (e) {
      console.log('Failed during handleWebhook of Webex Teams event:', e.message)
      return res.status(500).send()
    }
  } else {
    console.log('Webex Teams webhook event failed validation. Returning 401.')
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
