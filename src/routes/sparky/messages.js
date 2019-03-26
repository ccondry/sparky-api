const express = require('express')
const router = express.Router()
const Session = require('../../session')
const db = require('../../models/db')

async function getSession (id) {
  try {
    const session = await db.findOne('chat.session', {id})
    if (session) {
      // generate session object from database data
      return new Session('sparky-ui', session, function (message) {
        // do nothing during sendMessage
      })
    } else {
      return null
    }
  } catch (e) {
    throw e
  }
}

// receive new customer messages from sparky-ui client
router.post('/', (req, res) => {
  // parse and log request body
  const body = req.body
  console.log('Incoming: ' + JSON.stringify(body))

  if (!body.sessionId) {
    // 400 invalid input
    return res.status(400).send('"sessionId" is a required JSON property in the request body.')
  }
  // has session ID in body
  getSession(body.sessionId)
  .then(session => {
    // session found - add message to the session
    session.addCustomerMessage(req.body.text)
    // return ACCEPTED
    return res.status(202).send()
  }).catch(e => {
    // invalid session
    return res.status(404).send('Chat session not found.')
  })
})

// return all messages associated with input sessionId
router.get('/', (req, res) => {
  // validate input
  if (!req.query || !req.query.sessionId) {
    console.log('client tried to get chat messages, but provided no sessionId in request query parameters.')
    return res.status(400).send('"sessionId" is a required query parameter.')
  }
  getSession(req.query.sessionId)
  .then(session => {
    if (!session) {
      return res.status(404).send('Chat session not found.')
    }
    // console.log(req.query.sessionId, '- sparky-ui chat session found in database.')
    // did session expire?
    session.checkExpiration()
    if (session.hasExpired) {
      // session has expired. return 400
      console.log(req.query.sessionId, '- chat session has expired.')
      return res.status(400).send('Chat session has expired.')
    } else {
      // return OK with session data
      return res.status(200).send(session.messages)
    }
  })
  .catch(e => {
    console.log(req.query.sessionId, '- failed to get chat session info from database:', e.message)
    // invalid session
    return res.status(404).send('Chat session not found.')
  })
})

module.exports = router
