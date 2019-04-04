const request = require('request-promise-native')
const Session = require('../session.js')
// console.log('Session', Session)
const DB = require('./db')
const db = new DB('cumulus')
// const Entities = require('html-entities').AllHtmlEntities
// const entities = new Entities()
// const hydra = require('./hydra')
const striptags = require('striptags')
const facebookSessions = {}
const localization = require('./localization')
// global cache for chat sessions
const cache = require('./sessions')

function findPage (id) {
  return db.findOne('facebook.page', {id})
}

function getKnownUser (pageId, userId) {
  return db.findOne('facebook.users', {pageId, userId})
}

function handlePostback(sender, postback, page) {
  switch (postback.payload) {
    case 'yes': sendMessage(recipient, 'Thanks!', page); break
    case 'no': sendMessage(recipient, 'Oops, try sending another image.', page); break
  }
}

// Get the sender info from FB
function getSenderInfo(sender_psid, page) {
  // console.log(`getSenderInfo - sender_psid = ${sender_psid} ; page.token = ${page.token}`)
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
async function sendMessage(id, message, page) {
  if (!message || message.length === 0) {
    console.log(`Not sending empty string to Facebook.`)
    return
  }
  const access_token = page.token
  try {
    const text = striptags(message)
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
    console.error('facebook.sendMessage - Error sending message:', e.message)
  }
}

function onAddMessage (type, message, datetime) {
  console.log('in facebook onAddMessage')
  // attach handler to send messages to facebook
  sendMessage(this.senderId, message, this.page)
}

function onTypingStart (from) {
  request({
    url: 'https://graph.facebook.com/v2.6/me/messages',
    qs: {access_token: this.page.token},
    method: 'POST',
    json: {
      recipient: {id: this.senderId},
      sender_action: 'typing_on'
    }
  })
  .catch(e => {
    console.error('facebook.onTypingStart - Error sending onTypingStart event:', e.message)
  })
}

function onTypingStop (from) {
  request({
    url: 'https://graph.facebook.com/v2.6/me/messages',
    qs: {access_token: this.page.token},
    method: 'POST',
    json: {
      recipient: {id: this.senderId},
      sender_action: 'typing_off'
    }
  })
  .catch(e => {
    console.error('facebook.onTypingStop - Error sending onTypingStop event:', e.message)
  })
}

function findInCache (pageId, senderId) {
  // look for chat session in cache
  const keys = Object.keys(cache)
  for (const key of keys) {
    const v = cache[key]
    if (v.pageId === pageId && v.senderId === senderId) {
      return v
    }
  }
}
// get session object from local cache, or create session object from
// database data (if found)
async function getSession (pageId, senderId) {
  try {
    const hit = findInCache(pageId, senderId)

    if (hit) {
      // found session in cache
      return hit
    } else {
      // not in cache. look in database
      const session = await db.findOne('chat.session', {pageId, senderId})
      if (session) {
        // generate session object from database data
        const newSession = new Session('facebook', session, onAddMessage, onTypingStart, onTypingStop)
        // add session to cache
        cache[session.id] = newSession
        // return the new session object
        return newSession
      } else {
        console.log('facebook chat session not found in database for pageId', pageId, 'and senderId', senderId)
        // session not found in database. return null to say not found
        return null
      }
    }
  } catch (e) {
    console.log('error looking up session info for facebook chat for pageId', pageId, 'and senderId', senderId, ':', e.message)
    // rethrow all errors
    throw e
  }
}

function addSession (session) {
  // add to cache
  cache[session.id] = session
  // add to database
  return db.insertOne('chat.session', session)
}

// handle incoming facebook messages from users to page
async function handleMessage (message) {
  // facebook user ID
  const userId = message.sender.id
  // facebook page ID
  const pageId = message.recipient.id
  console.log(`message received from user ${userId} on Facebook page ${pageId}`)
  if (!message.message) {
    // no message text - log and return
    console.log('non-message facebook webhook. ignoring.')
    return
  }
  // message text
  const messageText = message.message.text
  // was this a registration message?
  // message attachments
  const attachments = message.message.attachments
  // postbacks
  const postback = message.message.postback

  let session
  // find session, if exists
  session = await getSession(pageId, userId)
  // did session expire?
  if (session) {
    const expired = await session.checkExpiration()
    if (expired) {
      // session has expired. unset session var
      session = undefined
    }
  }
  // if session doesn't exist, create one
  if (!session) {
    console.log('new facebook chat session')
    // find page info in database
    const page = await findPage(pageId)
    console.log('page', page)
    if (page === null || !page.token) {
      throw `Facebook page ${pageId} not registered. Please register this Facebook page with a token, AI token, and entry point ID.`
    }
    // get user info
    let firstName
    let lastName
    try {
      console.log('getting facebook user info')
      const fbUser = await getSenderInfo(userId, page)
      console.log('got facebook user info', fbUser)
      // console.log('fbUser =', fbUser)
      firstName = fbUser.first_name
      // console.log('firstName = ', firstName)
      lastName = fbUser.last_name
    } catch (e) {
      console.log(`failed to get facebook user info. Facebook returned HTTP ${e.statusCode}`, e.error)
    }
    console.log(`new facebook chat session for ${firstName} ${lastName}`)
    // enable bot by default
    let botEnabled = true
    // enable survey by default
    let survey = true
    // create session and store in sessions global
    session = new Session('facebook', {
      senderId: userId,
      pageId,
      page,
      botEnabled,
      survey,
      facebookUserId: userId,
      userId: userId,
      apiAiToken: page.apiAiToken || page.aiToken,
      entryPointId: page.entryPointId || page.entryPointId,
      phone: userId,
      email: userId,
      firstName,
      lastName
    }, onAddMessage, onTypingStart, onTypingStop)
    // add session to database and cache
    addSession(session)

    // getKnownUsers (pageId, '1731829546905168')
    try {
      const knownUser = await getKnownUser (pageId, userId)
      if (knownUser) {
        console.log(`${session.id} - I recognize this facebook user as`, knownUser)
        console.log(`${session.id} - setting known user's dcloud datacenter and session and sending them 'sparky' message.`)
        session.dcloudSession = knownUser.session
        session.dcloudDatacenter = knownUser.datacenter
        // get session info
        session.checkSessionInfo()
        // send regular welcome message, since we know this user's
        // dCloud datacenter and session ID
        session.addCustomerMessage('sparky')
      } else {
        // user not known, so set first message as sparky-fb, to ask for
        // dCloud datacenter and session ID
        session.addCustomerMessage('sparky-fb')
      }
    } catch (e2) {
      // couldn't find known users, so set first message as sparky-fb, to ask
      // for dCloud datacenter and session ID
      session.addCustomerMessage('sparky-fb')
    } finally {
      return
    }
  } else {
    console.log('existing facebook chat session')

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
            session.addMessage('bot', localization[session.languageCode].botFileAttachment)
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
}

module.exports = {
  sendMessage,
  handleMessage
}
