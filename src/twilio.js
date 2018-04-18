const request = require('request-promise-native')
const Session = require('./session.js')
// console.log('Session', Session)
const db = require('./mongodb')
const Entities = require('html-entities').AllHtmlEntities
const entities = new Entities()
// const hydra = require('./hydra')
const PhoneNumber = require('awesome-phonenumber')

const sessions = {}

const twilio = require('twilio')
const client = new twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN)

const contextService = require('./context-service')

// get dCloud session information
function getDcloudSession (from) {
  console.log('getting dcloud session info for', from)
  const pn = PhoneNumber(from)
  let phone
  if (pn.getNumber('regionCode') === 'US') {
    // use US phone number without +1
    phone = pn.getNumber('significant')
  } else {
    // use non-US number without +
    phone = from.slice(1)
  }
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

// send twilio SMS to user
function sendMessage(from, to, body) {
  if (!body || body.length === 0) {
    console.log(`Not sending empty string to SMS.`)
    return
  }

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
  if (session && new Date().getTime() > session.expiry) {
    //remove session from sessions
    removeSession(session)
    // unset session var
    session = undefined
  }

  // if session doesn't exist, create one
  if (!session) {
    console.log('new Twilio SMS chat session')
    // remove + from phone number
    const pn = PhoneNumber(from)
    let phone
    if (pn.getNumber('regionCode') === 'US') {
      // use US phone number without +1
      phone = pn.getNumber('significant')
    } else {
      // use non-US number without +
      phone = from.slice(1)
    }

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
      dcloudSession = await getDcloudSession(from)
    } catch (e) {
      console.error('Error getting dCloud phone number registration info', e.message)
    }

    let answers = {}
    let firstName = undefined
    let lastName = undefined
    let email = undefined
    try {
      // get dCloud answers information that user submitted (hopefully)
      answers = await getAnswers(phone)
      firstName = answers.userName.split(' ')[0]
      lastName = answers.userName.substring(firstName.length)
      email = answers.emailAddress
    } catch (e) {
      console.error('Error getting dCloud session info', e)
    }

    // create session and store in sessions global
    session = new Session('twilio', {
      type: 'twilio',
      to,
      from,
      phone,
      email: email || customerData.email || phone,
      firstName: firstName || customerData.firstName || phone,
      lastName: lastName || customerData.lastName || '',
      // apiAiToken: botConfig.aiToken,
      // entryPointId: brandConfig.entryPointId,
      dcloudSession: dcloudSession.session,
      dcloudDatacenter: dcloudSession.datacenter,
      botEnabled: true,
      survey: true,
      onAddMessage: async function (type, message) {
        // send messages to SMS user, and decode HTML characters
        try {
          const smsResponse = await sendMessage(to, from, entities.decode(message))
          // console.log('smsResponse', smsResponse)
          console.log(`SMS sent to ${from}`)
        } catch (e) {
          console.error(e)
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
    console.log(`existing SMS chat session with ${from}`)
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
