const request = require('request-promise-native')
const Session = require('./session.js')
// console.log('Session', Session)
const db = require('./mongodb')
const Entities = require('html-entities').AllHtmlEntities
const entities = new Entities()
const hydra = require('./hydra')
const PhoneNumber = require('awesome-phonenumber')

const sessions = {}

const twilio = require('twilio')

// const accountSid = process.env.twilio_account_sid // Your Account SID from www.twilio.com/console
// const authToken = process.env.twilio_auth_token   // Your Auth Token from www.twilio.com/console


async function getContextCustomerData(phone) {
  // try to match up the phone number with a user's info
  const customerData = {}
  // try Context Service first
  const params = {
    q: phone,
    field: 'query_string',
    token: process.env.CS_TOKEN_GET_CUSTOMER
  }
  const customers = await axios.get(`https://cxdemo.net/labconfig/api/demo/cs/customer`, {params})
  console.log(`Twilio - getContextCustomerData - found ${customers.data.length} matching customer(s) in Context Service`)
  if (!customers.data.length) {
    throw `no Context Service customers found matching ${phone}`
  }
  // get customer ID from Context Service
  console.log('Twilio - getContextCustomerData - chose first Context Service customer -', customers.data[0].customerId)
  const customer = customers.data[0]
  // get customer data
  customerData.firstName = customer.Context_First_Name
  customerData.lastName = customer.Context_Last_Name
  customerData.email = customer.Context_Work_Email
  return customerData
}

async function getDemoUser(phone) {
  const response1 = await hydra({
    service: 'cxdemo-config-service',
    path: `users`,
    query: {phones: phone}
  })
  console.log(`Twilio - getDemoUser - found ${response1.results.length} CXDemo user(s)`)
  const user = response1.results[0]
  if (!user) {
    throw `No customer information found`
  }
  console.log('Twilio - getDemoUser - chose first CXDemo user')
  return user
}

async function getDemoUserCustomerData (user) {

  const customerData = {}
  // find an email address for the user
  try {
    customerData.email = user.emails[0]
  } catch (e) {
    customerData.email = user.email
  }
  customerData.firstName = user.givenName
  customerData.lastName = user.sn

  return customerData
}

// function getDemoConfig (user) {
//   const config = {}
//   if (user && user.sms && user.sms.apps) {
//     if (user.brand.sms.bot.enabled === false) {
//       config.botEnabled = false
//     } else {
//       config.botEnabled = true
//       if (user.brand.sms.bot.aiToken) {
//         config.apiAiToken = user.brand.sms.bot.apiAiToken
//       } else {
//         config.apiAiToken = process.env.APIAI_TOKEN
//       }
//       if (user.brand.sms.entryPointId) {
//         config.entryPointId = user.brand.sms.bot.entryPointId
//       } else {
//         config.entryPointId = process.env.SMS_ENTRY_POINT_ID
//       }
//     }
//   }
//   return config
// }

// send twilio SMS to user
function sendMessage(from, to, body, app) {
  if (!body || body.length === 0) {
    console.log(`Not sending empty string to SMS.`)
    return
  }
  console.log('app', app)
  const client = new twilio(app.sid, app.token)
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

function findApp (id) {
  console.log('finding sms.apps matching', id)
  return db.findOne('sms.apps', {id})
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
  let isRegistrationMessage = false
  let session
  // find session, if exists
  session = getSession(to, from)
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

    let demoUser
    try {
      // get CXDemo user info
      demoUser = await getDemoUser(phone)
    } catch (e) {
      console.log(`failed to find demo user info for SMS number ${phone}`, e)
      // demo user not found for this phone number
      // was this a registration message?
      if (body && body.startsWith('register ') && body.split(' ').length === 2 && body.split(' ').pop().length < 9) {
        isRegistrationMessage = true
        console.log(`Twilio - SMS register command message received from ${from} on ${to}`)
        // extract username
        const username = body.split(' ').pop()
        // register phone number without country code
        // const pn = new PhoneNumber(from)
        // const significant = pn.getNumber('significant')
        const pn = from.slice(1)
        try {
          // register username, and get demo user data from the user info
          demoUser = await registerUsername(username, pn)
          console.log(`SMS number ${pn} has been registered in CXDemo to ${username}`)
        } catch (e) {
          console.error(`failed to register SMS number ${pn} to ${username}`, e)
          // continue? they can still use the bot, but escalation will fail
        }
      }
    }

    let customerData
    try {
      // get customer data from Context Service
      customerData = await getContextCustomerData(phone)
    } catch (e) {
      // use CXDemo user data
      customerData = await getDemoUserCustomerData(demoUser)
    }
    // console.log('customerData', customerData)
    // const demoConfig = getDemoConfig(demoUser, to)
    let brandConfig = {}
    let botConfig = {}
    try {
      // look up user info from cxdemo
      // userData = await getDemoUserData(personEmail)
      // console.log('found demo user data:', userData)
      // get user's facebook brand config for this page, if exists
      brandConfig = demoUser.sms.apps[to] || {}
      console.log('found brand config in user data:', brandConfig)
      botConfig = brandConfig.bot || {}
      console.log('found bot config in user data:', botConfig)
    } catch (e) {
      // continue
    }
    let botEnabled = true
    if (botConfig.enabled === false) {
      botEnabled = false
    }
    // enable survey by default
    let survey = true
    if (brandConfig.survey === false) {
      survey = false
    }
    // find app default config in database
    const app = await findApp(to)
    // create session and store in sessions global
    session = new Session('twilio', {
      type: 'twilio',
      to,
      from,
      phone,
      email: customerData.email,
      firstName: customerData.firstName,
      lastName: customerData.lastName,
      apiAiToken: botConfig.aiToken || app.aiToken,
      entryPointId: brandConfig.entryPointId || app.entryPointId,
      botEnabled,
      survey,
      onAddMessage: async function (type, message) {
        // send messages to SMS user, and decode HTML characters
        try {
          const smsResponse = await sendMessage(to, from, entities.decode(message), app)
          // console.log('smsResponse', smsResponse)
          console.log(`SMS sent to ${from}`)
        } catch (e) {
          console.error(e)
        }
      },
      onDeescalate: function () {
        console.log('onDeescalate')
        // remove this session from global sessions
        removeSession(this)
      }
    })
    // add session to global sessions
    addSession(session)
  } else {
    console.log(`existing SMS chat session with ${from}`)
  }
  // was there text in the message?
  if (body && !isRegistrationMessage) {
    // add message to session data
    session.addCustomerMessage(body)
  }
  // were there any attachments?
  // if (attachments) {
  //   // process attachments to send to agent
  //   attachments.forEach(attachment => {
  //     // are we escalated to an eGain agent?
  //     if (session.isEscalated) {
  //       // send the file to the agent in eGain
  //       session.egainSession._sendCustomerAttachmentNotification(attachment.payload.url, `${session.firstName} ${session.lastName}`)
  //     } else {
  //       // was it just a sticker?
  //       if (attachment.payload.sticker_id) {
  //         // ignore stickers
  //         console.log(`${session.firstName} ${session.lastName} sent a Facebook sticker. Ignoring sticker.`)
  //         // add message to transcript
  //         session.addMessage('customer', '(sticker)')
  //         // send message to facebook user
  //         // sendMessage(userId, message, page)
  //       } else {
  //         console.log(`${session.firstName} ${session.lastName} sent a file attachment.`)
  //         // note that user attached a file
  //         session.addMessage('customer', '(file attachment)')
  //         // just the bot here - let user know we can't do anything with them
  //         const m = `I'm sorry, but I can't handle file attachments. If you would like to speak to an agent, say 'agent'.`
  //         // add message to transcript
  //         session.addMessage('bot', m)
  //         // send message to facebook user
  //         sendMessage(userId, m, page)
  //       }
  //     }
  //   })
  // }
}

async function registerUsername (username, id) {
  console.log(`registering ${id} for ${username}`)
  // try to find the user's current SMS registration data
  const response1 = await hydra({
    method: 'get',
    service: 'cxdemo-config-service',
    path: `users/${username}`
  })
  const user = response1.results[0]
  if (!user) {
    // user not found
    return responses.sendError(`User ${username} not found`)
  }
  // get current phone registrations
  const body = user.phones || []
  // add phone to current list
  body.push(id)
  // attempt registration by patching user data with new list
  const response2 = await hydra({
    method: 'patch',
    service: 'cxdemo-config-service',
    path: `users/${username}`,
    query: { field: 'phones' },
    body
  })

  return user
}

module.exports = {
  sendMessage,
  handleMessage
}
