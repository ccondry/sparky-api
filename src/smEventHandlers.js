module.exports = {create}

function create (uccx, session) {
  const handlers = {
    onMessageEvent (from, message) {
      console.log(session.id, from, 'said', message)
      // send agent message to customer
      session.addMessage('agent', message)
    },
    onStatusEvent (status, detail) {
      console.log(session.id, 'status event', status, detail)
    },
    onPresenceEvent (from, status) {
      console.log(session.id, 'presence event', from, status)
    },
    onPresenceJoined (from) {
      console.log(session.id, 'presence joined', from)
      session.addMessage('system', `${from} has joined the chat`)
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
    },
    onTypingStop (from) {
      console.log(session.id, from, 'stopped typing')
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
    },
    onStopPolling () {
      console.log(session.id, 'polling stopped')
    },
    onSessionExpired () {
      console.log(session.id, 'session expired')
      session.deescalate()
    }
  }

  return handlers
}
