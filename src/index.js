// Load our environment variables
require('dotenv').load()

// Needed to get around self signed certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
// Node includes
const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors')

// init express
const app = express()
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(cors())

// this version
app.use('/api/v1/version', require('./version'))
// receive new customer messages from sparky-ui client
app.use('/api/v1/messages', require('./routes/messages'))
// TODO - build out attachments API
app.use('/api/v1/attachment', require('./routes/attachment'))
// TODO - use or remove this
app.use('/api/vi/ai', require('./routes/ai'))
// session management for sparky-ui client
app.use('/api/v1/session', require('./routes/session'))
// Facebook webhook
app.use('/api/v1/fb', require('./routes/facebook'))

// listen on port defined in .env
const server = app.listen(process.env.PORT || 5000, () => {
  console.log('Express server listening on port %d in %s mode', server.address().port, app.settings.env)
})
