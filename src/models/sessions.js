// sessions storage
const sessions = {}

// set up interval to check each session for expiration each minute
setInterval(function () {
  console.log('checking each session expiration')
  for (const id of Object.keys(sessions)) {
    const session = sessions[id]
    session.checkExpiration().catch(e => {
      console.error(`error during session.checkExpiration in setInterval loop of models/sessions.js:`, e)
    })
  }
}, 1000)

module.exports = sessions
