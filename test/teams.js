require('dotenv').config()
const request = require('request-promise-native')
const error = require('./error.json')

// send to teams as an attached file
async function sendMessage({
  toPersonEmail,
  roomId,
  roomType,
  text,
  markdown,
  files
}) {
  // if (!text || text.length === 0) {
  //   return console.log(`collab-toolbot - Not sending empty string to Webex Teams.`)
  // }
  const url = `https://api.ciscospark.com/v1/messages`
  try {
    const formData = {
      files
    }
    // determine group or direct message
    if (roomType === 'group') {
      formData.roomId = roomId
    } else {
      formData.toPersonEmail = toPersonEmail
    }
    // attach text, if supplied
    if (text) {
      formData.text = text
    }
    // attach text, if supplied
    if (markdown) {
      formData.markdown = markdown
    }
    const response = await request({
      method: 'POST',
      url,
      // body,
      headers: {
        'Authorization': `Bearer ${process.env.WEBEX_BOT_TOKEN}`,
        'content-type': 'multipart/form-data'
      },
      formData,
      json: true
    })
    return response
  } catch (e) {
    throw e
  }
}

const fileData = new Buffer.from(JSON.stringify(error, null, 2))
const filename = 'error.json'
const contentType = 'application/json'

sendMessage({
  toPersonEmail: 'ccondry@cisco.com',
  roomType: 'direct',
  // roomId: undefined,
  // text: 'hi **you**',
  markdown: 'hi **you**',
  files: {
    value: fileData,
    options: {
      filename,
      contentType
    }
  }
})
.then(r => console.log('successfully sent message with file:', r))
.catch(e => console.log('failed to send message with file:', e.message))