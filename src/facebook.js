// Facebook token
const PAGE_ACCESS_TOKEN = process.env.FB_TOKEN

const request = require('request-promise-native')

// if (!message || message.length === 0 || message.trim().length === 0) {
//   // don't try to send an empty message to facebook
//   console.log('sendMessage: message text to Facebook was empty or blank. Not sending to Facebook.')
// }

// function handleMessage(sender_psid, received_message) {
//   let response;
//
//   // Checks if the message contains text
//   if (received_message.text) {
//     // Create the payload for a basic text message, which
//     // will be added to the body of our request to the Send API
//     response = {
//       "text": `You sent the message: "${received_message.text}". Now send me an attachment!`
//     }
//   } else if (received_message.attachments) {
//     response = {
//       "attachment":
//       {
//         "type":"template",
//         "payload":{
//           "template_type":"generic",
//           "elements":[
//             {
//               "title":"Welcome to Peter'\''s Hats",
//               "image_url":"https://capricorn.ucplanning.com",
//               "subtitle":"We'\''ve got the right hat for everyone.",
//               "default_action": {
//                 "type": "web_url",
//                 "url": "https://capricorn.ucplanning.com",
//                 "messenger_extensions": true,
//                 "webview_height_ratio": "tall",
//                 "fallback_url": "https://capricorn.ucplanning.com"
//               },
//               "buttons":[
//                 {
//                   "type":"web_url",
//                   "url":"https://capricorn.ucplanning.com",
//                   "title":"View Website"
//                 },{
//                   "type":"postback",
//                   "title":"Start Chatting",
//                   "payload":"DEVELOPER_DEFINED_PAYLOAD"
//                 }
//               ]
//             }
//           ]
//         }
//       }
//     }
//   }
//   callSendAPI(sender_psid, response);
// }

function handlePostback(sender, postback) {
  switch (postback.payload) {
    case 'yes': sendMessage(recipient, 'Thanks!'); break
    case 'no': sendMessage(recipient, 'Oops, try sending another image.'); break
  }
}

// Get the sender info from FB
function getSenderInfo(sender_psid) {
  // Send the HTTP request to the Messenger Platform
  return request({
    url: `https://graph.facebook.com/v2.6/${sender_psid}`,
    qs: {
      fields: 'first_name,last_name,profile_pic',
      access_token: PAGE_ACCESS_TOKEN
    },
    method: 'GET',
    json: true
  })
}

// send facebook message
async function sendMessage(id, text) {
  if (!text || text.length === 0) {
    console.log(`Not sending empty string to Facebook.`)
    return
  }
  try {
    await request({
      url: 'https://graph.facebook.com/v2.6/me/messages',
      qs: {access_token: PAGE_ACCESS_TOKEN},
      method: 'POST',
      json: {
        recipient: {id},
        message: {text}
      }
    })
  } catch (e) {
    console.log('facebook.sendMessage - Error sending message:', e);
  }
}

module.exports = {
  sendMessage,
  getSenderInfo,
  handlePostback
}
