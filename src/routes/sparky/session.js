const express = require('express')
const router = express.Router()
const Session = require('../../session')
const sessions = require('../../sessions')

// get new session ID for sparky-ui client
router.post('/', async (req, res) => {
  // console.log('request to create new session: ', req.body)

  // set up function to remove session when it has expired, etc.
  req.body.removeSession = function () {
    delete sessions[this.id]
  }
  // create session and store in sessions global
  const session = new Session('sparky-ui', req.body)
  // wait for the checkSessionInfo method to finish, so that any custom config
  // is applied before we start the chat bot
  await session.checkSessionPromise

  // store new session in sessions global
  sessions[session.id] = session

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

  // generate uuid and return to client
  return res.status(200).send({sessionId: session.id})
})

module.exports = router
