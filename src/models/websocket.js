// global cache for chat sessions
const cache = require('./sessions')
// load WebSocket library
const WebSocket = require('ws')
// chat session class
const Session = require('../session')
// database model
const db = require('./db')

function start (server) {
  console.log('starting websocket server')
  //initialize the WebSocket server instance
  const wss = new WebSocket.Server({ server })
  wss.on('connection', newConnection)
}

// create session object from database data, if found
async function getSession (id) {
  try {
    // look for chat session in cache
    if (cache[id]) {
      // console.log(id, '- found chat session in cache. attaching onAddMessage handler for websocket.')
      cache[id].onAddMessage = function (type, message, datetime) {
        // console.log(this.id, '- attempting to send websocket message to client:', message)
        // attach handler to send messages to web socket client
        this.websocket.send(JSON.stringify({
          datetime,
          text: message,
          type
        }))
      }
      // in cache
      return cache[id]
    } else {
      // console.log(id, '- chat session not in cache. looking in database...')
      // not in cache. look in database
      const session = await db.findOne('chat.session', {id})
      if (session) {
        // console.log(id, '- chat session found in database.')
        // generate session object from database data
        const newSession = new Session('sparky-ui', session, function (type, message, datetime) {
          // console.log('test ccondry')
          // console.log(this.id, '- attempting to send websocket message to client:', message)
          // attach handler to send messages to web socket client
          this.websocket.send(JSON.stringify({
            datetime,
            text: message,
            type
          }))
        })
        // console.log(id, '- chat session object created.')
        // add session to cache
        cache[id] = newSession
        // console.log(id, '- chat session added to cache.')
        // return the new session object
        return newSession
      } else {
        console.log(id, '- chat session not found in database.')
        // session not found in database. return null to say not found
        return null
      }
    }
  } catch (e) {
    console.log(id, '- error looking up session info:', e.message)
    // rethrow all errors
    throw e
  }
}

function newConnection (ws) {
  // new websocket connection is up - set up handlers
  ws.on('message', async (message) => {
    const json = JSON.parse(message)
    // log the received message and send it back to the client
    // console.log('websocket message received:', json)
    // find chat session
    const session = await getSession(json.sessionId)
    if (!session) {
      // invalid session ID. close websocket.
      console.log('session ID not found. closing websocket.')
      ws.close()
    } else {
      // valid session. attach this websocket reference to the session in cache
      // console.log(session.id, '- session ID found. attaching websocket to cache object.')
      session.websocket = ws
      // was there a message from the client?
      if (json.text) {
        // add to session object
        session.addCustomerMessage(json.text)
      }
    }
  })
}

module.exports = {
  start
}
