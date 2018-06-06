const axios = require('axios')

// looks up customer in Context Service and creates a new
// Context Service POD with current chat transcript
async function send (session) {
  try {
    // generate transcript string
    let transcript = ''
    session.messages.forEach(message => {
      transcript += `${message.type}: ${message.text}\r\n\r\n`
    })

    const body = {
      "fieldsets": [
        "cisco.base.pod",
        "cisco.dcloud.cumulus.chat"
      ],
      "type": "activity",
      "state": "active",
      "mediaType": process.env.TRANSCRIPT_MEDIA_TYPE || "chat",
      "tags": ["transcript", "bot"],
      "dataElements": [
        {
          "Context_Notes": "Bot Chat Transcript",
          "type": "string"
        },
        {
          "Context_Chat_Transcript": transcript,
          "type": "string"
        },
        {
          "Context_POD_Activity_Link": "https://mm-chat.cxdemo.net/",
          "type": "string"
        },
        {
          "Context_POD_Source_Cust_Name": `${session.firstName} ${session.lastName}`,
          "type": "string"
        },
        {
          "Context_POD_Source_Phone": session.phone,
          "type": "string"
        },
        {
          "Context_POD_Source_Email": session.email,
          "type": "string"
        }
      ]
    }

    // create transcript activity
    await axios.post(`${session.csHost}/activity`, body)
    console.log(`sendTranscript: successfully created transcript activity in Context Service for ${session.email}`)
  } catch (e) {
    console.error(`sendTranscript: exception while creating transcript activity in Context Service for ${session.email}`, e.message)
    throw e
  }
}

module.exports = {send}
