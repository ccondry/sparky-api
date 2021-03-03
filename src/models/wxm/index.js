const fetch = require('../fetch')
const uccx = require('./uccx')
const pcce = require('./pcce')
const teamsLogger = require('../teams-logger')

// which entry point used to chat with bot
const touchpoints = {
  'sparky-ui': 'Website Chat Bot',
  facebook: 'Facebook Messenger Chat Bot',
  whatsapp: 'WhatsApp Chat Bot',
  twilio: 'Mobile App SMS Chat Bot'
  // outbound: 'Outbound IVR Survey'
}

// valid demo types
const demos = {
  uccx,
  pcce
}

// send survey answers to WXM cloud REST endpoint
async function send (session) {
  // choose UCCX or PCCE demo details
  const demo = demos[session.demo]
  if (!demo) {
    // log demo type not recognized
    const message = `${session.id} - unable to send WXM survey answers because "${session.demo}" is not a recognized demo type. Valid demo types are: ${Object.keys(demos).join(', ')}`
    console.log(message)
    teamsLogger.log(message)
    return
  }

  // build REST URL with the static demo ID for UCCX or PCCE
  const url = 'https://api.getcloudcherry.com/api/surveybytoken/' + demo.id
  // build auth header from credentials
  const auth = Buffer.from(`${demo.username}:${demo.password}`, 'utf-8').toString('base64')

  // REST body
  const body = {
    // the static demo ID for UCCX or PCCE
    id: demo.id,
    // this is always null
    restrictBySignature: null,
    // timestamp
    responseDateTime: new Date(),
    // the responses
    responses: [{
      // customer name
      questionId: demo.questionIds.name,
      textInput: session.firstName + ' ' + session.lastName
    }, {
      // email
      questionId: demo.questionIds.email,
      textInput: session.email 
    }, {
      // phone
      questionId: demo.questionIds.phone,
      textInput: session.phone
    }, {
      // first rating
      questionId: demo.questionIds.nps,
      numberInput: parseInt(session.surveyAnswers[0] || '9')
    }, {
      // second rating
      questionId: demo.questionIds.ces,
      numberInput: parseInt(session.surveyAnswers[1] || '5')
    }, {
      // touchpoint
      questionId: demo.questionIds.touchpoint,
      textInput: touchpoints[session.type]
    }]
  }

  // add customer ID, agent ID, and team ID if they exist in session data
  // Customer ID
  if (session.userId) {
    body.responses.push({
      questionId: demo.questionIds.customerId,
      textInput: String(session.userId)
    })
  } else {
    // log WXM survey that did not have user ID to associate
    const message = `${session.id} did not have a user ID to associate with their WXM survey.`
    console.log(message)
    teamsLogger.log(message)
  }
  
  // Agent ID
  if (session.agentId) {
    body.responses.push({
      questionId: demo.questionIds.agentId,
      textInput: String(session.agentId)
    })
  }

  // Team ID
  if (session.teamId) {
    body.responses.push({
      questionId: demo.questionIds.teamId,
      textInput: String(session.teamId)
    })
  }

  // build fetch options
  const options = {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + auth,
      'Content-Type': 'application/json'
    },
    body
  }

  try {
    // send REST request for WXM survey
    console.log('sending WXM survey data:', body)
    await fetch(url, options)
    // TODO reduce logging here?
    console.log(`${session.id} - sent WXM survey responses to survey "${demo.id}"`)
  } catch (e) {
    // log the error
    const message = `${session.id} - failed to send WXM survey: ${e.message}`
    console.log(message)
    teamsLogger.log(message)
  }
}

module.exports = {
  send
}