const Session = require('../session.js')
const db = require('./db')
const cache = require('./sessions')
const PhoneNumber = require('awesome-phonenumber')
const twilio = require('twilio')
const striptags = require('striptags')

function findApp (id) {
  return db.findOne('cumulus', 'twilio.app', {id})
}

function getLookupNumber (from, to) {
  const pnFrom = PhoneNumber(from)
  const pnTo = PhoneNumber(to)
  // check if customer is in same country as Whatsapp number
  if (pnFrom.getRegionCode() === pnTo.getRegionCode()) {
    // customer region === Whatsapp region
    return pnFrom.getNumber('significant')
  } else if (to === process.env.TWILIO_APJ_NUMBER && pnFrom.getRegionCode() === 'SG') {
    // Singapore customer using the APJ Whatsapp number (which is not in Singapore)
    return pnFrom.getNumber('significant')
  } else {
    // customer is messaging to a foreign Whatsapp number, so just remove the +
    return from.slice(1)
  }
}

// get dCloud session information from phone number
function getDcloudSession (from, to) {
  console.log('getting dcloud session info for', from)
  const phone = getLookupNumber(from, to)

  return db.findOne('cumulus', 'phones', {phone})
}

// get dCloud session information from mobile app answers
function getAnswers (from, to) {
  const phone = getLookupNumber(from, to)
  return db.findOne('cumulus', 'answers', {phone})
}

// send twilio Whatsapp to user
function sendMessage(from, to, body, client) {
  if (!body || body.length === 0) {
    console.log(`Not sending empty string to Whatsapp.`)
    return
  }
  // strip HTML from body
  body = striptags(body)

  return client.messages.create({
    body,
    to: 'whatsapp:' + to,  // Text this number
    from: 'whatsapp:' + from // From a valid Twilio number
  })
}

function onAddMessage (type, message, datetime) {
  console.log('creating Twilio client with SID', this.app.sid)
  // create Twilio client
  const client = new twilio(this.app.sid, this.app.token)
  // send messages to SMS user
  sendMessage(this.to, this.from, message, client)
  .then(r => {
    console.log(this.id, `- Whatsapp message sent to ${this.from}`)
  })
  .catch(e => {
    console.error(this.id, `failed to send Whatsapp message to customer ${this.from} using ${this.to}.`)
  })
}

function findInCache (to, from) {
  // look for chat session in cache
  const keys = Object.keys(cache)
  for (const key of keys) {
    const v = cache[key]
    if (v.to === to && v.from === from) {
      return v
    }
  }
}

// get session object from local cache, or create session object from
// database data (if found)
async function getSession (to, from) {
  try {
    // look for chat session in cache
    const hit = findInCache(to, from)
    if (hit) {
      // found session in cache
      return hit
    } else {
      // not in cache. look in database
      const session = await db.findOne('cumulus', 'chat.session', {to, from})
      if (session) {
        // generate session object from database data
        const newSession = new Session('twilio', session, onAddMessage)
        // add session to cache
        cache[session.id] = newSession
        // return the new session object
        return newSession
      } else {
        // session not found in database. return null to say not found
        return null
      }
    }
  } catch (e) {
    console.log('error looking up session info for twilio SMS to', to, 'and from', from, ':', e.message)
    // rethrow all errors
    throw e
  }
}

function addSession (session) {
  // add to cache
  cache[session.id] = session
  // add to db
  return db.insertOne('cumulus', 'chat.session', session)
}

// handle incoming twilio messages
async function handleMessage (message) {
  try {
    // from - remove 'whatsapp:' from the address to get phone number
    const from = message.From.split('whatsapp:').pop()
    // to - remove 'whatsapp:' from the address to get phone number
    const to = message.To.split('whatsapp:').pop()
    // Whatsapp body
    const body = message.Body
    console.log(`Twilio - Whatsapp received from ${from} on ${to}`)
    let session
    // find session, if exists
    session = await getSession(to, from)
    // did session expire?
    if (session) {
      session.checkExpiration()
      if (session.hasExpired) {
        // session has expired. unset session var
        session = undefined
      }
    }

    // if session doesn't exist, create one
    if (!session) {
      console.log('new Twilio Whatsapp chat session')
      // get the appropriate part of the phone number to use for lookups
      const phone = getLookupNumber(from, to)

      let dcloudSession = {}
      try {
        dcloudSession = (await getDcloudSession(from, to)) || {}
      } catch (e) {
        console.error('Error getting dCloud phone number registration info', e.message)
      }
      // find app info in database
      const app = await findApp(to)
      // validate app
      if (app === null || !app.token || !app.sid) {
        throw `Twilio app ${to} not registered. Please register this Twilio app with a id, sid, and token.`
      }

      let answers = {}
      let firstName = undefined
      let lastName = undefined
      let email = undefined
      let userId = undefined
      try {
        console.log('sparky-api - Whatsapp - looking up mobile app answers for', phone, '...')
        // get dCloud answers information that user submitted (hopefully)
        answers = await getAnswers(from, to)
        if (answers === null) {
          console.log('sparky-api - Whatsapp - did not find any mobile app answers for', phone, '.')
        }
        // get instant demo username from the POD ID that user entered into the
        // settings screen of the mobile app
        userId = answers.podId
        email = answers.emailAddress
        // first name is the string of non-space characters before the first space
        firstName = answers.userName.split(' ')[0]
        // last name is the rest of the userName value, after firstName
        lastName = answers.userName.substring(firstName.length)
      } catch (e) {
        console.error('sparky-api - Whatsapp - did not find dCloud session info from answers:', e.message)
      }
      // create session and store in sessions global
      session = new Session('whatsapp', {
        type: 'whatsapp',
        to,
        from,
        app,
        phone,
        userId,
        email: email || phone,
        firstName: firstName || phone,
        lastName: lastName || '',
        dcloudSession: dcloudSession.session,
        dcloudDatacenter: dcloudSession.datacenter,
        botEnabled: true,
        survey: true
      }, onAddMessage)
      // add session to sessions cache and to database
      await addSession(session)
      // set first message as sparky
      session.addCustomerMessage('sparky')
      // don't do anything else
      return
    } else {
      console.log(`existing Whatsapp chat session with ${from}`)
    }
    // was there text in the message?
    if (body) {
      // add message to session data
      session.addCustomerMessage(body)
    }
  } catch (e) {
    console.log('error during Whatsapp handleMessage:', e)
  }
}

module.exports = {
  sendMessage,
  handleMessage
}
