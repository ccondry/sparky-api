const request = require('request-promise-native')

module.exports = {
  message: {
    send: sendMessage
  }
}

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

