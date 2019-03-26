const express = require('express')
const router = express.Router()
const Session = require('../../session')
const db = require('../../models/db')
const cache = require('../../models/sessions')

// get new session ID for sparky-ui client
router.post('/', async (req, res) => {
  // console.log('request to create new session: ', req.body)

  // create session and store in sessions database
  const session = new Session('sparky-ui', req.body, function (message) {
    console.log('test jimothy')
    // do nothing during sendMessage - client will retrieve messages with GET
  })
  
  // also put it in cache
  cache[session.id] = session

  // wait for the checkSessionInfo method to finish, so that any custom config
  // is applied before we start the chat bot
  try {
    await session.checkSessionPromise
  } catch (e) {
    console.log('failed checkSessionPromise:', e.message)
  }

  // store new session in sessions db
  try {
    await db.insertOne('chat.session', session)
  } catch (e) {
    console.log(session.id, '- failed to add chat session to database:', e.message)
    return res.status(500).send('Failed to start chat session. Server error is:' + e.message)
  }

  // check if bot is disabled
  if (!session.botEnabled) {
    // bot is disabled - escalate right away
    session.escalate()
  } else {
    // bot is enabled (default)
    // start conversation off by sending message 'sparky' as the customer, to get
    // the initial configured message from the AI bot
    session.processCustomerMessage('sparky')
  }

  // return session uuid to client
  return res.status(200).send({sessionId: session.id})
})

module.exports = router
