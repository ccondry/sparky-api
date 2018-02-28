// Load our environment variables
require('dotenv').load()

// Needed to get around self signed certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
// Node includes
const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors')
const hydraExpress = require('hydra-express')
const hydra = hydraExpress.getHydra()
const pkg = require('../package.json')

// set up hydra and redis config
const hydraConfig = {
  hydra: {
    serviceName: pkg.name,
    serviceIP: process.env.hydra_service_ip || '',
    servicePort: process.env.hydra_service_port || 0,
    serviceType: process.env.hydra_service_type || '',
    serviceDescription: pkg.description,
    redis: {
      url: process.env.redis_url,
      port: process.env.redis_port,
      db: process.env.redis_db
    }
  }
}


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
app.use('/api/v1/facebook', require('./routes/facebook'))

// init hydra and start express
hydraExpress.init(hydraConfig, () => {})
.then(serviceInfo => {
  // listen on port defined in .env
  const server = app.listen(process.env.PORT || 5000, () => {
    console.log('Express server listening on port %d in %s mode', server.address().port, app.settings.env)
  })
})
.catch(e => {
  console.log(e)
  process.exit(1)
})
