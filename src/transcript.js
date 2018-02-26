const axios = require('axios')

// looks up customer in Context Service and creates a new
// Context Service POD with current chat transcript
async function send (session) {
  try {
    // look up customer ID
    const params = {
      q: session.email,
      field: 'query_string',
      token: process.env.CS_TOKEN_GET_CUSTOMER
    }
    let customers
    try {
      customers = await axios.get(`https://cxdemo.net/labconfig/api/demo/cs/customer`, {params})
      console.log(`sendTranscript: found ${customers.data.length} matching customer(s) in Context Service`)
    } catch (e) {
      console.log(`sendTranscript: exception while looking up Context Service customer ${session.email}`, e)
      throw e
    }

    // get customer ID from Context Service
    console.log('sendTranscript: chose first Context Service customer -', customers.data[0].customerId)
    const customer = customers.data[0]

    // generate transcript string
    let transcript = ''
    session.messages.forEach(message => {
      transcript += `${message.type}: ${message.text}\r\n\r\n`
    })

    const body = {
      "customerId": customer.customerId,
      "mediaType": "chat",
      "dataElements":{
        "Context_Notes": "Bot Chat Transcript",
        "Context_POD_Activity_Link": "https://sparky.cxdemo.net/",
        "Context_POD_Source_Cust_Name": `${session.firstName} ${session.lastName}`,
        "Context_POD_Source_Phone": session.phone,
        "Context_POD_Source_Email": session.email,
        "Context_Chat_Transcript": transcript
      },
      "tags": ["transcript", "bot"],
      // "requestId":"4c26daa0-c8b5-11e7-81c3-11121369121d",
      "fieldsets":["cisco.base.pod", "cisco.dcloud.cumulus.chat"],
      "token": process.env.CS_TOKEN_CREATE_POD,
    }

    // create transcript POD
    await axios.post('https://cxdemo.net/labconfig/api/demo/cs/pod/', body)
    console.log(`sendTranscript: successfully created POD in Context Service for ${session.email}`)
  } catch (e) {
    console.log(`sendTranscript: exception while creating transcript POD in Context Service for ${session.email}`, e)
    throw e
  }
}

module.exports = {send}
