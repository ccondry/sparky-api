// Load our environment variables
require('dotenv').load()

// Needed to get around self signed certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
// Node includes
const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors')
const pkg = require('../package.json')

// init express
const app = express()
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(cors())

// this version
app.use('/api/v1/version', require('./version'))
// session management for sparky-ui client
app.use('/api/v1/sparky/session', require('./routes/sparky/session'))
// receive new customer messages from sparky-ui client
app.use('/api/v1/sparky/messages', require('./routes/sparky/messages'))
// TODO - build out attachments API
app.use('/api/v1/attachment', require('./routes/attachment'))
// TODO - use or remove this
app.use('/api/vi/ai', require('./routes/ai'))

// Facebook webhook
app.use('/api/v1/facebook', require('./routes/facebook'))
// Twilio webhook
app.use('/api/v1/twilio', require('./routes/twilio'))
// Whatsapp webhook
app.use('/api/v1/whatsapp', require('./routes/whatsapp'))
// Cisco Webex Teams webhooks
app.use('/api/v1/teams', require('./routes/teams'))

// listen on port defined in .env
const server = app.listen(process.env.PORT || 5000, () => {
  console.log('Express server listening on port %d in %s mode', server.address().port, app.settings.env)
})
