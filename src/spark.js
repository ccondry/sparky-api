const Session = require('./session.js')
// console.log('Session', Session)
const db = require('./mongodb')
const Entities = require('html-entities').AllHtmlEntities
const entities = new Entities()
// const hydra = require('./hydra')
const axios = require('axios')

const sessions = {}

// handle incoming Spark webhooks - retrieve the message and pass info
// to the handleMessage function
async function handleWebhook (body) {
  // ignore messages that we sent
  if (body.actorId === body.createdBy) {
    return
  }
  // find app config in database
  const app = await findApp(body.appId)
  // console.log('app', app)
  if (app === null || !app.token) {
    throw `Spark app ${appId} not registered. Please register this Spark app with a Spark access token and Spark bot ID.`
  }
  // req.body.data.roomType = 'direct'
  // console.log('Spark webhook', body)
  const roomType = body.data.roomType
  if (roomType === 'direct') {
    // direct message - go retrieve the message details
    const messageId = body.data.id
    const options = {
      headers: {
        'Authorization': `Bearer ${app.token}`
      }
    }
    try {
      const response = await axios.get(`https://api.ciscospark.com/v1/messages/${messageId}`, options)
      console.log('response.data', response.data)
      await handleMessage(app, response.data)
    } catch (e) {
      console.error('error during Spark handleWebhook', e)
    }
  } else {
    console.log(`Spark webhook received, but it was not direct room type. room type = ${roomType}`)
  }
}

async function handleMessage (app, {text, personEmail, personId, roomId, files}) {
  const appId = app.id
  console.log(`message received from Spark user ${personEmail} on app ID ${appId}:`, text)

  let session
  // find session, if exists
  session = getSession(appId, personEmail)
  // did session expire?
  if (new Date().getTime() > session.expiry) {
    //remove session from sessions
    removeSession(session)
    // unset session var
    session = undefined
  }
  // if session doesn't exist, create one
  if (!session) {
    console.log('new Spark chat session')
    // get user info
    const user = await getSenderInfo(personId, app.token)
    // console.log('found Spark user info', user.data)
    const firstName = user.data.firstName
    const lastName = user.data.lastName
    console.log(`new Spark chat session is for ${firstName} ${lastName}`)
    let userData = {}
    let brandConfig = {}
    let botConfig = {}
    try {
      // look up user info from cxdemo
      userData = await getDemoUserData(personEmail)
      console.log('found demo user data:', userData)
      // get user's facebook brand config for this page, if exists
      brandConfig = userData.apps[appId] || {}
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
    // create session and store in sessions global
    session = new Session('spark', {
      appId,
      appToken: app.token,
      botEnabled,
      survey,
      apiAiToken: botConfig.aiToken || app.apiAiToken || app.aiToken,
      entryPointId: brandConfig.entryPointId || app.entryPointId,
      personId,
      phone: userData.phone || '',
      email: personEmail,
      firstName,
      lastName,
      onAddMessage: function (type, message) {
        // send messages to Spark user, and decode HTML characters
        sendMessage(personEmail, entities.decode(message), app).catch(e => {
          const error = {
            status: e.response.status,
            data: e.response.data
          }
          console.error('Error sending Spark message: ', error)
        })
      },
      onDeescalate: function () {
        console.log('onDeescalate')
        removeSession(this)
      }
    })
    // add session to global sessions
    addSession(session)
  } else {
    console.log(`existing Spark chat session with ${session.email}`)
  }
  // was there text in the message?
  if (text) {
    // add message to session data
    session.addCustomerMessage(text)
  }
  // were there any attachments?
  if (files && files.length) {
    // process attachments to send to agent
    files.forEach(file => {
      // are we escalated to an eGain agent?
      if (session.isEscalated) {
        // download the file locally and get a public URL for it
        // const attachmentUrl = await saveAttachment(file, app)
        // TODO generate a real URL here
        const attachmentUrl = 'https://gribgcdrqn.localtunnel.me/api/v1/attachment/123'
        // send the file to the agent in eGain
        session.egainSession._sendCustomerAttachmentNotification(attachmentUrl, `${session.firstName} ${session.lastName}`)
      } else {
        console.log(`${session.firstName} ${session.lastName} sent a file attachment.`)
        // note that user attached a file
        session.addMessage('customer', '(file attachment)')
        // just the bot here - let user know we can't do anything with them
        const m = `I'm sorry, but I can't handle file attachments. If you would like to speak to an agent, say 'agent'.`
        // add message
        session.addMessage('bot', m)
      }
    })
  }
}

async function getDemoUserData(email) {
  const data = {}
  // if this is a facebook chat, try to match up the facebook ID with
  // a user's email address and phone number
  const response1 = await hydra({
    service: 'cxdemo-config-service',
    path: `users`,
    query: {emails: email}
  })
  const user = response1.results[0]
  // find an email address for the user
  // try {
  //   data.email = user.emails[0]
  // } catch (e) {
  //   // default to lab user's email
  //   data.email = user.email
  // }
  // find a phone number for the user
  try {
    data.phone = user.phones[0]
  } catch (e) {
    if (user.telephoneNumber) {
      data.phone = user.telephoneNumber
    } else {
      // do nothing
    }
  }
  // get brand config for facebook pages for the user
  try {
    data.apps = user.spark.apps
  } catch (e) {
    // do nothing
  }
  return data
}

function findApp (id) {
  return db.findOne('spark.apps', {id})
}

// async function registerPage (id, token, aiToken, entryPointId) {
//   const page = db.upsert('spark.apps', {pageId}, {
//     id,
//     token,
//     aiToken,
//     entryPointId
//   })
// }

// Get the sender info from FB
function getSenderInfo(personId, token) {
  const options = {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
  return axios.get(`https://api.ciscospark.com/v1/people/${personId}`, options)
}

// send facebook message from page to user
async function sendMessage(toPersonEmail, text, {token}) {
  if (!text || text.length === 0) {
    return console.log(`Not sending empty string to Spark.`)
  }
  const url = `https://api.ciscospark.com/v1/messages`
  const body = {toPersonEmail, text}
  const options = {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
  await axios.post(url, body, options)
}

function getSession (appId, email) {
  try {
    return sessions[appId][email]
  } catch (e) {
    return undefined
  }
}

function removeSession (session) {
  console.log(`remove Spark session [${session.data.appId}][${session.email}]`)
  try {
    delete sessions[session.data.appId][session.email]
    // console.log(`sessions`, sessions)
  } catch (e) {
    // do nothing
    console.error(e)
  }
}

function addSession (session) {
  sessions[session.data.appId] = sessions[session.data.appId] || {}
  sessions[session.data.appId][session.email] = sessions[session.data.appId][session.email] || {}
  sessions[session.data.appId][session.email] = session
  // console.log('sessions', sessions)
}

// async function saveAttachment (url, {token}) {
//   const options = {
//     responseType: 'arrayBuffer',
//     headers: {
//       'Authorization': `Bearer ${token}`
//     }
//   }
//   const response = await axios.get(url, options)
//   const buf = new Buffer(response.data, 'binary')
//
// }

module.exports = {
  handleWebhook
}
