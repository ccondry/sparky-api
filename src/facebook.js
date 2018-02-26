// Facebook token
const PAGE_ACCESS_TOKEN = process.env.FB_TOKEN

const request = require('request-promise-native')

// Data Structure for brokering FB connections
function FBUser(fname, lname, psid, avatar) {
  this._first_name = fname
  this._last_name = lname
  this._psid = psid
  this._avatar = ""
  this._chat = null
}
// Linked List Structure of FBUsers
function Node(data) {
  this.data = data;
  this.next = null;
}

function SinglyList() {
  this._length = 0;
  this.head = null;
}

SinglyList.prototype.add = function(value) {
  var node = new Node(value),
  currentNode = this.head;

  // 1st use-case: an empty list
  if (!currentNode) {
    this.head = node;
    this._length++;

    return node;
  }
  // 2nd use-case: a non-empty list
  while (currentNode.next) {
    currentNode = currentNode.next;
  }
  currentNode.next = node;
  this._length++;
  return node;
};

SinglyList.prototype.searchNodeAt = function(position) {
  var currentNode = this.head,
  length = this._length,
  count = 1,
  message = {failure: 'Failure: non-existent node in this list.'};

  // 1st use-case: an invalid position
  if (length === 0 || position < 1 || position > length) {
    throw new Error(message.failure);
  }
  // 2nd use-case: a valid position
  while (count < position) {
    currentNode = currentNode.next;
    count++;
  }
  return currentNode;
};

SinglyList.prototype.remove = function(position) {
  var currentNode = this.head,
  length = this._length,
  count = 0,
  message = {failure: 'Failure: non-existent node in this list.'},
  beforeNodeToDelete = null,
  nodeToDelete = null,
  deletedNode = null;

  // 1st use-case: an invalid position
  if (position < 0 || position > length) {
    throw new Error(message.failure);
  }

  // 2nd use-case: the first node is removed
  if (position === 1) {
    this.head = currentNode.next;
    deletedNode = currentNode;
    currentNode = null;
    this._length--;

    return deletedNode;
  }

  // 3rd use-case: any other node is removed
  while (count < position) {
    beforeNodeToDelete = currentNode;
    nodeToDelete = currentNode.next;
    count++;
  }

  beforeNodeToDelete.next = nodeToDelete.next;
  deletedNode = nodeToDelete;
  nodeToDelete = null;
  this._length--;

  return deletedNode;
};

// Initialize our Linked List of FB Users
var sl = new SinglyList();
var fbSender = null;

function checkFBId(sender_psid) {
  if(sl.head !== null)
  {
    // Start searching at the first node
    var fbdata = sl.searchNodeAt(1);
    if(fbdata.data)
    {
      console.log("FB User: " + fbdata.data._first_name + " Last Name: " + fbdata.data._last_name + " PSID: " + fbdata.data._psid);
      if(fbdata.data._psid === sender_psid)
      {
        return sender_psid;
      }
    }
  }
  else
  {
    //var fbuser = new FBUser(fbSender['first_name'], fbSender['last_name'], sender_psid);
    var fbuser = new FBUser('Michael', 'Littlefoot', sender_psid);
    //console.log("Sender info: " + fbuser._first_name);
    sl.add(fbuser);
  }
  return sender_psid;
}

function callSendAPI(sender_psid, message) {
  if(sender_psid === '')
  {
    var fbdata = sl.searchNodeAt(1);
    sender_psid = fbdata.data._psid;
  }
  sendMessage({id: sender_psid}, JSON.stringify(message))
}

// send message to Facebook
function dispatchMsg(sender_psid, message) {
  if(sender_psid === '')
  {
    var fbdata = sl.searchNodeAt(1);
    sender_psid = fbdata.data._psid;
  }
  sendMessage({id: sender_psid}, {text: message})
}

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

function handlePostback(sender_psid, received_postback) {
  let response;
  // Get the payload for the postback
  let payload = received_postback.payload;

  // Set the response based on the postback payload
  if (payload === 'yes') {
    response = { "text": "Thanks!" }
  } else if (payload === 'no') {
    response = { "text": "Oops, try sending another image." }
  }
  // Send the message to acknowledge the postback
  callSendAPI(sender_psid, response);
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
async function sendMessage(recipient, message) {
  try {
    await request({
      url: 'https://graph.facebook.com/v2.6/me/messages',
      qs: {access_token: PAGE_ACCESS_TOKEN},
      method: 'POST',
      json: {
        recipient,
        message
      }
    })
  } catch (e) {
    console.log('facebook.sendMessage - Error sending message:', e);
  }
}

module.exports = {
  sendMessage,
  checkFBId,
  getSenderInfo,
  handlePostback,
  dispatchMsg
}
