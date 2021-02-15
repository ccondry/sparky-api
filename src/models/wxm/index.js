const fetch = require('../fetch')
const uccx = require('./uccx')
const pcce = require('./pcce')

// which entry point used to chat with bot
const touchpoints = {
  'sparku-ui': 'Website Chat Bot',
  facebook: 'Facebook Messenger Chat Bot',
  whatsapp: 'WhatsApp Chat Bot',
  twilio: 'Mobile App SMS Chat Bot'
  // outbound: 'Outbound IVR Survey'
}

const demos = {
  uccx,
  pcce
}

async function send (session) {
  const demo = demos[session.demo]
  if (!demo) {
    // log demo type not recognized
    console.log(`${session.id} - unable to send WXM survey answers because "${session.demo}" is not a recognized demo type. Valid demo types are: ${Object.keys(demos).join(', ')}`)
    return
  }
  const url = 'https://api.getcloudcherry.com/api/surveybytoken/' + demo.id
  // build auth header from credentials
  const auth = Buffer.from(`${demo.username}:${demo.password}`, 'utf-8').toString('base64')

  // REST body
  const body = {
    id,
    // this is always null
    restrictBySignature: null,
    responseDateTime: new Date(),
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
      numberInput: parseInt(session.surveyAnswers[1] || '8')
    }, {
      // touchpoint
      questionId: demo.questionIds.touchpoint,
      textInput: touchpoints[session.type]
    }]
  }

  const options = {
    headers: {
      Authorization: 'Basic ' + auth,
      'Content-Type': 'application/json'
    },
    body
  }

  try {
    // send REST request for WXM survey
    await fetch(url, options)
  } catch (e) {
    console.log('failed to send WXM survey:', e.message)
  }
}

// send survey answers to WXM cloud REST endpoint
module.exports = {
  send
}