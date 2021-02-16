const teamsLogger = require('./models/teams-logger')
const agentExtensions = require('./models/sm-agent-extensions')

module.exports = {create}

function create (session) {
  const handlers = {
    onMessageEvent (from, message) {
      console.log(session.id, from, 'said', message)
      // send agent message to customer
      session.addMessage('agent', message)
    },
    onStatusEvent (status, detail) {
      console.log(session.id, 'status event', status, detail)
      if (status === 'chat_timedout_waiting_for_agent') {
        // timeout trying to reach chat server
        // disable survey
        session.survey = false
        // query dialogFlow for a response
        session.addCustomerMessage('dcloud-timeout-waiting-for-agent')
      }
    },
    onPresenceEvent (from, status) {
      console.log(session.id, 'presence event', from, status)
    },
    onPresenceJoined (from) {
      // the "from" parameter will contain agent first name
      console.log(session.id, 'presence joined', from)
      session.addMessage('system', `${from} has joined the chat`)
      // build list of agent first names
      // find matching agentId
      let agentId = agentExtensions[from]
      if (agentId) {
        // found matching agent name/agentId
        if (session.isInstantDemo && session.userId) {
          // instant demo
          agentId += session.userId
        } else {
          // scheduled demo
        }
        // set agent ID for survey data
        session.setAgentId(agentId)
      }
    },
    onPresenceLeft (from) {
      console.log(session.id, 'presence left', from)
      session.addMessage('system', `${from} has left the chat`)
    },
    onLastParticipantLeft () {
      console.log(session.id, 'last participant left')
      session.deescalate()
    },
    onTypingEvent (from, status) {
      console.log(session.id, 'typing event', from, status)
    },
    onTypingStart (from) {
      console.log(session.id, from, 'is typing')
      if (typeof session.onTypingStart === 'function') {
        session.onTypingStart(from)
      }
    },
    onTypingStop (from) {
      console.log(session.id, from, 'stopped typing')
      if (typeof session.onTypingStop === 'function') {
        session.onTypingStop(from)
      }
    },
    onOtherEvent (type, ev) {
      console.log(session.id, 'other event', type, ev)
    },
    onAgentTimeout (message) {
      console.log(session.id, 'agent timeout', message)
      session.deescalate()
    },
    onChatCreated () {
      console.log(session.id, 'chat created')
      // session.addMessage('system', `Please wait while we connect you with a customer care representative...`)
    },
    onStopPolling () {
      console.log(session.id, 'polling stopped')
    },
    onSessionExpired () {
      console.log(session.id, 'session expired')
      session.deescalate()
    },
    onPollingError (e) {
      // UCCX polling error
      console.log(session.id, 'UCCX polling error:', e.message)
      // log unexpected errors to Webex Team space
      if (e.statusCode !== 404 && e.message.match(/^WebSocket is not open/i)) {
        teamsLogger.log(`${session.id} - UCCX polling error: ${e.message}`)
      }
    }
  }

  return handlers
}
