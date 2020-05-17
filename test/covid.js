// Load our environment variables
require('dotenv').config()

// load required libraries
const dialogflow = require('dialogflow').v2beta1
const credentials = require('../src/models/credentials')
const uuidv1 = require('uuid/v1')

// run
go()
.then(r => console.log('done?', r))
.catch(e => console.log('error:', e))

// define main test code block
async function go () {
  try {

    console.log('started covid test')
    // the google cloud project ID
    const projectId = 'covidfaq-bpuccs'
    // generate a session ID
    const id = uuidv1()
    console.log('id', id)
  
    // get credentials json from our database
    const creds = await credentials.get(projectId)
    // create session client to dialogflow
    const sessionClient = new dialogflow.SessionsClient({
      projectId,
      credentials: creds
    })
    
    // build dialogflow session path
    const sessionPath = sessionClient.sessionPath(projectId, id)
    
    function buildRequest (q) {
      // The dialogflow query body
      return {
        session: sessionPath,
        queryInput: {
          text: {
            // The query to send to the dialogflow agent
            text: q,
            // The language used by the client (en-US)
            languageCode: 'en-US'
          }
        }
      }
    }
  
    // test queries
    // const q1 = 'sparky'
    const q1 = 'Is there a vaccine, drug or treatment for COVID-19?'
    // const q2 = 'covid/19 spread'
    // const q3 = 'Is covid-19 the same as SARS?'
  
    // Send requests and log responses
    const r1 = await sessionClient.detectIntent(buildRequest(q1))
    console.log(q1, 'response:', JSON.stringify(r1, null, 2))
    // const r2 = await sessionClient.detectIntent(buildRequest(q2))
    // console.log(q2, 'response:', r2)
    // const r3 = await sessionClient.detectIntent(buildRequest(q3))
    // console.log(q3, 'response:', r3)
  } catch (e) {
    // rethrow all errors
    throw e
  }
}