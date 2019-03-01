const request = require('request-promise-native')
const Session = require('./session.js')
// console.log('Session', Session)
const db = require('./mongodb')
// const Entities = require('html-entities').AllHtmlEntities
// const entities = new Entities()
// const hydra = require('./hydra')
const PhoneNumber = require('awesome-phonenumber')

const sessions = {}

const twilio = require('twilio')
const client = new twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN)
const contextService = require('./context-service')
const striptags = require('striptags')

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

  return request({
    method: 'GET',
    url: `${process.env.API_BASE}/api/v1/phones/${phone}`,
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
    url: `${process.env.API_BASE}/api/v1/answers/${phone}`,
    headers: {
      'Authorization': `Bearer ${process.env.DCLOUD_API_TOKEN}`
    },
    json: true
  })
}

// send twilio SMS to user
function sendMessage(from, to, body) {
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
    console.error(`failed to remove Twilio SMS session sessions[${session.data.to}][${session.data.from}]`, e)
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
  // sms from
  const from = message.From
  // sms to
  const to = message.To
  // sms body
  const body = message.Body
  console.log(`Twilio - SMS received from ${from} on ${to}`)
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
    console.log('new Twilio SMS chat session')
    // get the appropriate part of the phone number to use for lookups
    const phone = getLookupNumber(from, to)

    let customerData = {}
    try {
      // get customer data from Context Service
      customerData = await contextService.getCustomerData(phone)
    } catch (e) {
      // failed CS lookup
      console.log(`could not retreive Context Service data for Twilio SMS from ${phone}:`, e.message)
    }

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
    session = new Session('twilio', {
      type: 'twilio',
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
      backupNumber: process.env.TWILIO_BACKUP_NUMBER,
      onAddMessage: async function (type, message) {
        // send messages to SMS user, and decode HTML characters
        try {
          // const decodedMessage = entities.decode(message)
          // console.log('sending decoded SMS message:', decodedMessage)
          const smsResponse = await sendMessage(to, from, message)
          // console.log('smsResponse', smsResponse)
          console.log(this.id, `- SMS sent to ${from}`)
        } catch (e) {
          console.error(this.id, `failed to send SMS to customer ${this.data.from} using ${this.data.to}. Retrying with backup number ${this.data.backupNumber}`)
          // unavailable using the current number?
          if (e.status === 400 && e.code === 21612) {
            // update this session to use the backup US number
            try {
              updateSessionTo(session, this.data.backupNumber)
              // try again
              // const decodedMessage = entities.decode(message)
              const smsResponse2 = await sendMessage(this.data.to, this.data.from, message)
            } catch (e2) {
              console.error(this.id, `failed to send SMS to customer at ${this.data.form} from backup number ${this.data.to}. fix me!`)
            }
          }
        }
      },
      removeSession: function () {
        console.log(this.id, 'removeSession')
        // remove this session from global sessions
        removeSession(this)
      }
    })
    // add session to global sessions
    addSession(session)
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
}

module.exports = {
  sendMessage,
  handleMessage
}
