const express = require('express')
const router = express.Router()
// const axios = require('axios')
const crypto = require('crypto')
const spark = require('../spark')

// Accepts POST requests at /webhook endpoint for Facebook
router.post('/message-events', (req, res) => {
  // console.log(`Cisco Spark webhook event on webhook ID ${req.body.id}`)
  if (validateRequest(req, process.env.spark_bot_webhook_secret)) {
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
