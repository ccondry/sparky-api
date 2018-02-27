const request = require('request-promise-native')
const Session = require('./session.js')
// console.log('Session', Session)
const db = require('./mongodb')
const Entities = require('html-entities').AllHtmlEntities
const entities = new Entities()

const facebookSessions = {}

async function findPage (id) {
  const page = db.findOne('facebook.pages', {id})
  if (page !== null) {
    return page
  } else {
    // if not found, add to database for easier tracking
    // db.insert('facebook.pages', {
    //   pageId
    // })
  }
}

async function registerPage (id, token, aiToken, entryPointId) {
  const page = db.upsert('facebook.pages', {pageId}, {
    id,
    token,
    aiToken,
    entryPointId
  })
}

function handlePostback(sender, postback, page) {
  switch (postback.payload) {
    case 'yes': sendMessage(recipient, 'Thanks!', page); break
    case 'no': sendMessage(recipient, 'Oops, try sending another image.', page); break
  }
}

// Get the sender info from FB
async function getSenderInfo(sender_psid, page) {
  const access_token = page.token
  // Send the HTTP request to the Messenger Platform
  return request({
    url: `https://graph.facebook.com/v2.6/${sender_psid}`,
    qs: {
      fields: 'first_name,last_name,profile_pic',
      access_token
    },
    method: 'GET',
    json: true
  })
}

// send facebook message from page to user
async function sendMessage(id, text, page) {
  if (!text || text.length === 0) {
    console.log(`Not sending empty string to Facebook.`)
    return
  }
  const access_token = page.token
  try {
    await request({
      url: 'https://graph.facebook.com/v2.6/me/messages',
      qs: {access_token},
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

function getFacebookSession (pageId, senderId) {
  try {
    return facebookSessions[pageId][senderId]
  } catch (e) {
    return null
  }
}

function addFacebookSession (session) {
  const pageId = session.page.id
  const senderId = session.userId
  facebookSessions[pageId] = facebookSessions[pageId] || {}
  facebookSessions[pageId][senderId] = facebookSessions[pageId][senderId] || {}
  facebookSessions[pageId][senderId] = session
}

async function handleMessage (message) {
  // facebook user ID
  const userId = message.sender.id
  // facebook page ID
  const pageId = message.recipient.id
  console.log(`message received from user ${userId} on Facebook page ${pageId}`)
  // message text
  const messageText = message.message.text
  // message attachments
  const attachments = message.message.attachments
  // postbacks
  const postback = message.message.postback

  let session
  // find session, if exists
  session = getFacebookSession(pageId, userId)
  // if session doesn't exist, create one
  if (session === null) {
    // find page info in database
    const page = await findPage(pageId)
    console.log('page', page)
    if (page === null || !page.token || !page.aiToken || !page.entryPointId) {
      throw `Facebook page ${pageId} not registered. Please register this Facebook page with a token, AI token, and entry point ID.`
    }
    // get user info
    const fbUser = await getSenderInfo(message.sender.id, page)
    // console.log('fbUser =', fbUser)
    const firstName = fbUser.first_name
    // console.log('firstName = ', firstName)
    const lastName = fbUser.last_name
    console.log(`new facebook chat session for ${firstName} ${lastName}`)
    // new session
    // create session and store in sessions global
    session = new Session('facebook', {
      page,
      userId,
      phone: userId,
      email: userId,
      firstName,
      lastName,
      callback: function (type, message) {
        // send messages to facebook user, and decode HTML characters
        sendMessage(userId, entities.decode(message), page)
      }
    })
    // add session to global Facebook sessions
    addFacebookSession(session)
  }
  // was there text in the message?
  if (messageText) {
    // add message to session data
    session.addCustomerMessage(messageText)
  }
  // were there any attachments?
  if (attachments) {
    // process attachments to send to agent
    attachments.forEach(attachment => {
      // are we escalated to an eGain agent?
      if (session.isEscalated) {
        // send the file to the agent in eGain
        session.egainSession._sendCustomerAttachmentNotification(attachment.payload.url, `${session.firstName} ${session.lastName}`)
      } else {
        // was it just a sticker?
        if (attachment.payload.sticker_id) {
          // ignore stickers
          console.log(`${session.firstName} ${session.lastName} sent a Facebook sticker. Ignoring sticker.`)
          // add message to transcript
          session.addMessage('customer', '(sticker)')
          // send message to facebook user
          // sendMessage(userId, message, page)
        } else {
          console.log(`${session.firstName} ${session.lastName} sent a file attachment.`)
          // note that user attached a file
          session.addMessage('customer', '(file attachment)')
          // just the bot here - let user know we can't do anything with them
          const m = `I'm sorry, but I can't handle file attachments. If you would like to speak to an agent, say 'agent'.`
          // add message to transcript
          session.addMessage('bot', m)
          // send message to facebook user
          sendMessage(userId, m, page)
        }
      }
    })
  }
  // was there a postback?
  if (postback) {
    // log postback details
    console.log(`Facebook postback for ${firstName} ${lastName}`, postback)
    // handlePostback(userId, postback, pageId)
  }
}

module.exports = {
  sendMessage,
  handleMessage
}
