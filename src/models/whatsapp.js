const request = require('request-promise-native')
const Session = require('../session.js')
// console.log('Session', Session)
const db = require('../mongodb')
// const Entities = require('html-entities').AllHtmlEntities
// const entities = new Entities()
// const hydra = require('./hydra')
const PhoneNumber = require('awesome-phonenumber')
// const contextService = require('../context-service')
const twilio = require('twilio')
const striptags = require('striptags')

const sessions = {}

const client = new twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN)

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

// get dCloud session information
function getDcloudSession (from, to) {
  console.log('getting dcloud session info for', from)
  const phone = getLookupNumber(from, to)

  return request({
    method: 'GET',
    url: `https://mm.cxdemo.net/api/v1/phones/${phone}`,
    headers: {
      authorization: 'Bearer ' + process.env.DCLOUD_API_TOKEN
    },
    json: true
  })
}

// get dCloud session information
function getAnswers (phone) {
  return request({
    method: 'GET',
    url: `https://mm.cxdemo.net/api/v1/answers/${phone}`,
    headers: {
      'Authorization': `Bearer ${process.env.DCLOUD_API_TOKEN}`
    },
    json: true
  })
}

// send twilio Whatsapp to user
function sendMessage(from, to, body) {
  if (!body || body.length === 0) {
    console.log(`Not sending empty string to Whatsapp.`)
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

function getSession (to, from) {
  try {
    return sessions[to][from]
  } catch (e) {
    return undefined
  }
}

function removeSession (session) {
  try {
    delete sessions[session.data.to][session.data.from]
  } catch (e) {
    console.error(`failed to remove Twilio Whatsapp session sessions[${session.data.to}][${session.data.from}]`, e)
  }
}

function updateSessionTo (session, newTo) {
  removeSession(session)
  session.data.to = newTo
  addSession(session)
}

function addSession (session) {
  const to = session.data.to
  const from = session.data.from
  sessions[to] = sessions[to] || {}
  sessions[to][from] = sessions[to][from] || {}
  sessions[to][from] = session
}

// handle incoming twilio messages
async function handleMessage (message) {
  // from - remove 'whatsapp:' from the address to get phone number
  const from = message.From.split('whatsapp:').pop()
  // to - remove 'whatsapp:' from the address to get phone number
  const to = message.To.split('whatsapp:').pop()
  // Whatsapp body
  const body = message.Body
  console.log(`Twilio - Whatsapp received from ${from} on ${to}`)
  let session
  // find session, if exists
  session = getSession(to, from)
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

    let customerData = {}
    // try {
    //   // get customer data from Context Service
    //   customerData = await contextService.getCustomerData(phone)
    // } catch (e) {
    //   // failed CS lookup
    //   console.log(`could not retreive Context Service data for Twilio Whatsapp from ${phone}:`, e.message)
    // }

    let dcloudSession = {}
    try {
      dcloudSession = await getDcloudSession(from, to)
    } catch (e) {
      console.error('Error getting dCloud phone number registration info', e.message)
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
    session = new Session('whatsapp', {
      type: 'whatsapp',
      to,
      from,
      phone,
      userId,
      email: email || customerData.Context_Work_Email || phone,
      firstName: firstName || customerData.Context_First_Name || phone,
      lastName: lastName || customerData.Context_Last_Name || '',
      // apiAiToken: botConfig.aiToken,
      // entryPointId: brandConfig.entryPointId,
      dcloudSession: dcloudSession.session,
      dcloudDatacenter: dcloudSession.datacenter,
      botEnabled: true,
      survey: true,
      // backupNumber: process.env.TWILIO_BACKUP_NUMBER,
      onAddMessage: async function (type, message) {
        // send messages to Whatsapp user, and decode HTML characters
        try {
          // const decodedMessage = entities.decode(message)
          // console.log('sending decoded Whatsapp message:', decodedMessage)
          const smsResponse = await sendMessage(to, from, message)
          // console.log('smsResponse', smsResponse)
          console.log(`Whatsapp sent to ${from}`)
        } catch (e) {
          console.error(`failed to send Whatsapp to customer ${this.data.from} using ${this.data.to}.`)
          const smsResponse = await sendMessage('whatsapp:' + to, 'whatsapp:' + from, entities.decode(message), app)

        }
      },
      removeSession: function () {
        console.log('removeSession')
        // remove this session from global sessions
        removeSession(this)
      }
    })
    // add session to global sessions
    addSession(session)
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
}

module.exports = {
  sendMessage,
  handleMessage
}
