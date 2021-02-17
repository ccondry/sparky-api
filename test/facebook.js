require('dotenv').config()
const request = require('request-promise-native')
const db = require('../src/models/db')

function findPage (id) {
  return db.findOne('cumulus', 'facebook.page', {id})
}
// Get the sender info from FB
function getSenderInfo(sender_psid, page) {
  // console.log(`getSenderInfo - sender_psid = ${sender_psid} ; page.token = ${page.token}`)
  const access_token = page.token
  // Send the HTTP request to the Messenger Platform
  return request({
    url: `https://graph.facebook.com/v2.6/${sender_psid}`,
    qs: {
      fields: 'first_name,last_name,profile_pic,email',
      access_token
    },
    method: 'GET',
    json: true
  })
}

findPage('103018720547240')
.then(page => getSenderInfo('1954937904577507', page))
.then(sender => console.log(sender))
.catch(e => console.log(e.message))