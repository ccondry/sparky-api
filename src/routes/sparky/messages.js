const express = require('express')
const router = express.Router()
const sessions = require('../../sessions')

// receive new customer messages from sparky-ui client
router.post('/', (req, res) => {
  // parse and log request body
  const body = req.body
  console.log('Incoming: ' + JSON.stringify(body))
  const sessionId = body.sessionId

  if (sessionId && sessions[sessionId]) {
    // valid session
    const session = sessions[sessionId]
    session.addCustomerMessage(req.body.text)

    // return ACCEPTED
    return res.status(202).send()
  } else {
    // invalid session
    return res.status(400).send({
      error: 'Invalid session ID'
    })
  }
})

// return message set to client
router.get('/', (req, res) => {
  const sessionId = req.query.sessionId

  if (sessionId && sessions[sessionId]) {
    // valid session
    const session = sessions[sessionId]
    // return OK with session data
    return res.status(200).send(session.messages)
  } else {
    // invalid session
    return res.status(400).send({
      error: 'Invalid session ID'
    })
  }
})

module.exports = router
