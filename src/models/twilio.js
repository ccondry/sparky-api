const request = require('request-promise-native')
const Session = require('../session.js')
// const entities = new Entities()
const PhoneNumber = require('awesome-phonenumber')
// global cache for chat sessions
const cache = require('./sessions')
// database
const DB = require('./db')
const db = new DB('cumulus')

const twilio = require('twilio')

const striptags = require('striptags')

function findApp (id) {
  return db.findOne('twilio.app', {id})
}

function getLookupNumber (from, to) {
  const pnFrom = PhoneNumber(from)
  const pnTo = PhoneNumber(to)
  // check if customer is in same country as SMS number
  if (pnFrom.getRegionCode() === pnTo.getRegionCode()) {
    // customer region === SMS region
    return pnFrom.getNumber('significant')
  } else if (to === process.env.TWILIO_APJ_NUMBER && pnFrom.getRegionCode() === 'SG') {
    // Singapore customer using the APJ SMS number (which is not in Singapore)
    return pnFrom.getNumber('significant')
  } else {
    // customer is messaging to a foreign SMS number, so just remove the +
    return from.slice(1)
  }
}

// get dCloud session information
function getDcloudSession (from, to) {
  console.log('getting dcloud session info for', from)
  const phone = getLookupNumber(from, to)

  return db.find('phones', {phone})
}

// get dCloud session information
function getAnswers (phone) {
  return db.find('answers', {phone})
}

// send twilio SMS to user
function sendMessage(from, to, body, client) {
  if (!body || body.length === 0) {
    console.log(`Not sending empty string to SMS.`)
    return
  }
  // strip HTML from body
  body = striptags(body)

  return client.messages.create({
    body,
    to,  // Text this number
    from // From a valid Twilio number
  })
}

function onAddMessage (type, message, datetime) {
  console.log('creating Twilio client with SID', this.app.sid)
  // create Twilio client
  const client = new twilio(this.app.sid, this.app.token)
  // send messages to SMS user
  sendMessage(this.to, this.from, message, client)
  .then(r => {
    console.log(this.id, `- SMS sent to ${this.from}`)
  })
  .catch(e => {
    console.error(this.id, `failed to send SMS to customer ${this.from} using ${this.to}.`)
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
      const session = await db.findOne('chat.session', {to, from})
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
  return db.insertOne('chat.session', session)
}

// handle incoming twilio messages
async function handleMessage (message) {
  try {
    // sms from
    const from = message.From
    // sms to
    const to = message.To
    // sms body
    const body = message.Body
    console.log(`Twilio - SMS received from ${from} on ${to}`)
    let session
    // find session, if exists
    session = await getSession(to, from)
    // did session expire?
    if (session) {
      const expired = await session.checkExpiration()
      if (expired) {
        // session has expired. unset session var
        session = undefined
      }
    }

    // if session doesn't exist, create one
    if (!session) {
      console.log('new Twilio SMS chat session')
      // get the appropriate part of the phone number to use for lookups
      const phone = getLookupNumber(from, to)

      let dcloudSession = {}
      try {
        dcloudSession = await getDcloudSession(from, to)
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
        // get dCloud answers information that user submitted (hopefully)
        answers = await getAnswers(phone)
        // get instant demo username from the POD ID that user entered into the
        // settings screen of the mobile app
        userId = answers.podId
        email = answers.emailAddress
        // first name is the string of non-space characters before the first space
        firstName = answers.userName.split(' ')[0]
        // last name is the rest of the userName value, after firstName
        lastName = answers.userName.substring(firstName.length)
      } catch (e) {
        console.error('Error getting dCloud session info', e)
      }
      // create session and store in sessions global
      session = new Session('twilio', {
        to,
        from,
        app,
        phone,
        userId,
        email: email || phone,
        firstName: firstName || phone,
        lastName: lastName || '',
        // apiAiToken: botConfig.aiToken,
        // entryPointId: brandConfig.entryPointId,
        dcloudSession: dcloudSession.session,
        dcloudDatacenter: dcloudSession.datacenter,
        botEnabled: true,
        survey: true
      }, onAddMessage)
      // add session to global sessions
      await addSession(session)
      // wait for the checkSessionInfo method to finish, so that any custom config
      // is applied before we start the chat bot
      await session.checkSessionPromise
      // check if session is an instant demo
      if (session.isInstantDemo) {
        // make sure customer is registered, then send sparky message to AI
        session.checkInstantDemoCustomer('sparky')
        // don't do anything else
        return
      } else {
        // set first message to AI as sparky, to trigger dialog with customer
        session.addCustomerMessage('sparky')
        // don't do anything else
        return
      }
    } else {
      console.log(session.id, `- existing SMS chat session with ${from}`)
    }
    // was there text in the message?
    if (body) {
      // add message to session data
      session.addCustomerMessage(body)
    }
  } catch (e) {
    console.error('error during twilio handleMessage:', e)
    // throw e
  }
}

module.exports = {
  sendMessage,
  handleMessage
}
