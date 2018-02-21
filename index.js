// Load our environment variables
require('dotenv').load();

// Needed to get around self signed certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
// Node includes
const express = require('express')
const bodyParser = require('body-parser')
const request = require('request-promise-native')
// const apiai = require('apiai')
const uuidv1 = require('uuid/v1')
const pkg = require('./package.json')
const cors = require('cors')
// init express
const app = express()
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(cors())

const server = app.listen(process.env.PORT || 5000, () => {
  console.log('Express server listening on port %d in %s mode', server.address().port, app.settings.env)
})

// Begin ECE
var eGainLibrarySettings = require('./egain/egainNode').eGainLibrarySettings;
var myLibrarySettings = new eGainLibrarySettings();
myLibrarySettings.CORSHost = process.env.ECE_HOST;
myLibrarySettings.IsDevelopmentModeOn = false;
myLibrarySettings.eGainContextPath = "./";
// var inChat = false;
var file = "";
/* Next create a new instance of the eGainLibrary */
/* passing in the settings you have just created. */
var eGainLibrary = require('./egain/egainNode').eGainLibrary;
var myLibrary = new eGainLibrary(myLibrarySettings);
myLibrary.CORSHost = process.env.ECE_HOST;


// ECE Parameters

var sender_psid = "";

// set up express routes
// test
app.get('/', function (req, res) {
  res.status(200).send('Hello world, I am a chat bot')
})

// this version
app.get('/api/v1/version', function (req, res) {
  res.status(200).send({
    version: pkg.version
  })
})

// this version
app.get('/version', function (req, res) {
  res.status(200).send({
    version: pkg.version
  })
})

// sessions storage
let sessions = {}
//
let tokens = {
  'cumulus-finance': '1c4d3b458b3f4109bec0b38f792cfc46',
  'sparky-retail': 'a2083e974dc84b599e86124fca44a9e3'
}
// get new session ID for client
app.post('/api/v1/session', (req, res) => {
  console.log('new session request', req.body)
  // get api.ai token
  let apiAiToken = req.body.apiAiToken || tokens[req.body.bot] || '1c4d3b458b3f4109bec0b38f792cfc46'

  // create session and store in sessions global
  const sessionId = uuidv1()
  sessions[sessionId] = {
    id: sessionId,
    state: 'active',
    messages: [],
    entryPointId: req.body.entryPointId || '1001',
    phone: req.body.phone,
    email: req.body.email,
    firstName: req.body.firstName,
    lastName: req.body.lastName,
    apiAiToken
  }

  // start conversation off with an initial message from the bot
  processCustomerMessage(sessions[sessionId], 'sparky')
  // generate uuid and return to client
  res.status(200).send({sessionId})
})

// receive new messages from client
app.post('/api/v1/messages', (req, res) => {
  // parse and log request body
  const body = req.body
  console.log('Incoming: ' + JSON.stringify(body))
  const sessionId = body.sessionId

  if (sessionId && sessions[sessionId]) {
    // valid session
    const session = sessions[sessionId]
    // is this chat escalated to an agent?
    if (session.escalated) {
      // send message to ECE agent
      session.eceSession.SendMessageToAgent(req.body.text)
      // add message to memory
      session.messages.push({
        text: req.body.text,
        type: 'customer',
        datetime: new Date().toJSON()
      })
      // check for command words
      switch (req.body.text) {
        case 'goodbye': {
          // end ECE session
          session.eceSession.End()
          // tell user session ended
          session.messages.push({
            text: 'Your session with our expert has ended, but you can still chat with Sparky.',
            type: 'system',
            datetime: new Date().toJSON()
          })
          // remove escalated flag
          session.escalated = false
          break
        }
      }
    } else {
      addCustomerMessage(session, req.body.text)
    }

    // return ACCEPTED
    return res.status(202).send()
  } else {
    // invalid session
    return res.status(400).send({
      error: 'Invalid session ID'
    })
  }
})

function addCustomerMessage (session, text) {
  // add message to memory
  session.messages.push({
    text,
    type: 'customer',
    datetime: new Date().toJSON()
  })
  processCustomerMessage(session, text)
}

async function processCustomerMessage (session, text) {
  try {
    // figure out a response using AI
    const response = await request({
      method: 'POST',
      url: 'https://api.api.ai/v1/query',
      headers: {
        'Authorization': `Bearer ${session.apiAiToken}`,
        'Accept': `application/json`,
        'Content-Type': `application/json; charset=utf-8`
      },
      qs: {
        v: '20170910'
      },
      body: {
        sessionId: '8bf7bfc0-167e-11e8-9419-d7112fa40fb8',
        q: text,
        lang: 'en'
      },
      json: true
    })
    // console.log('api.ai response', response)
    // process the response text
    processAiResponse(session, response.result.fulfillment.speech)

  } catch (e) {
    console.error('exception during addCustomerMessage', e)
  }
}

function processAiResponse (session, text) {
  switch (text) {
    case 'escalate': {
      // escalate request to agent
      escalateIt(session)
      break
    }
    case 'video': {
      // make REM video call
      break
    }
    default: {
      // add bot's reply to session's messages list
      session.messages.push({
        text,
        type: 'bot',
        datetime: new Date().toJSON()
      })
      break
    }
  }
}

// return message set to client
app.get('/api/v1/messages', (req, res) => {
  const sessionId = req.query.sessionId

  if (sessionId && sessions[sessionId]) {
    // valid session
    const session = sessions[sessionId]
    // return OK with session data
    return res.status(200).send(session.messages)
  } else {
    // invalid session
    return res.status(400).send({
      error: 'Invalid session ID'
    })
  }
})

app.post('api/v1/attachment', (req, res) => {
  // no session?
  // if(!inChat) {
  //   sendMessage(webhook_event)
  // } else if(inChat && typeof(myChat !== 'undefined')) {
  //   // Check for the sending of an attachment
  //   if(webhook_event.message.attachments) {
  //     //handleMessage(sender_psid, webhook_event.message);
  //     //myChat.getFileData(webhook_event.message.attachments[0].payload.url);
  //     // send attachment notification to ECE, to send to the agent
  //     myChat._sendCustomerAttachmentNotification(webhook_event.message.attachments[0].payload.url, "Michael Littlefoot")
  //   } else if (webhook_event.message.text === "goodbye") {
  //     // did the customer want to end the agent chat interaction?
  //     // end ECE chat
  //     myChat.End()
  //     // end session
  //     inChat = false
  //   } else {
  //     // send the message text to the agent
  //     myChat.SendMessageToAgent(webhook_event.message.text)
  //   }
  // }
})

/* Webhook for API.ai to get response from the 3rd party API */
app.post('/ai', (req, res) => {
  console.log('*** Webhook for api.ai query ***');
  console.log(req.body.result);

  if (req.body.result.action === 'weather') {
    console.log('*** weather ***');
    let city = req.body.result.parameters['geo-city'];
    let restUrl = 'http://api.openweathermap.org/data/2.5/weather?APPID='+WEATHER_API_KEY+'&q='+city;

    request.get(restUrl, (err, response, body) => {
      if (!err && response.statusCode == 200) {
        let json = JSON.parse(body);
        console.log(json);
        let tempF = ~~(json.main.temp * 9/5 - 459.67);
        let tempC = ~~(json.main.temp - 273.15);
        let msg = 'The current condition in ' + json.name + ' is ' + json.weather[0].description + ' and the temperature is ' + tempF + ' ℉ (' +tempC+ ' ℃).'
        return res.json({
          speech: msg,
          displayText: msg,
          source: 'weather'
        });
      } else {
        let errorMessage = 'I failed to look up the city name.';
        return res.status(400).json({
          status: {
            code: 400,
            errorType: errorMessage
          }
        });
      }
    })
  }

});



function escalateIt (session) {
  /* Create the customer object */
  // var ChatEntryPointId = "1001";
  // var PhoneNumber = "2142336226";
  // var EmailAddress = "ccondry@cisco.com";
  // var FirstName = "Coty";
  // var LastName = "Condry";

  var ChatEntryPointId = session.entryPointId
  var PhoneNumber = session.phone
  var EmailAddress = session.email
  var FirstName = session.firstName
  var LastName = session.lastName
  var customerObject = null;

  customerObject =  new myLibrary.Datatype.CustomerObject();
  customerObject.SetPrimaryKey(customerObject.PrimaryKeyParams.PRIMARY_KEY_EMAIL, EmailAddress);

  var customerFirstName = new myLibrary.Datatype.CustomerParameter();
  customerFirstName.eGainParentObject = "casemgmt";
  customerFirstName.eGainChildObject = "individual_customer_data";
  customerFirstName.eGainAttribute = "first_name";
  customerFirstName.eGainValue = FirstName;
  customerFirstName.eGainParamName = "first_name";
  customerFirstName.eGainMinLength = "1";
  customerFirstName.eGainMaxLength = "50";
  customerFirstName.eGainRequired = "1";
  customerFirstName.eGainFieldType = "1";
  customerFirstName.eGainPrimaryKey = "0";
  customerFirstName.eGainValidationString = "";
  customerObject.AddCustomerParameter(customerFirstName);

  var customerLastName = new myLibrary.Datatype.CustomerParameter();
  customerLastName.eGainParentObject = "casemgmt";
  customerLastName.eGainChildObject = "individual_customer_data";
  customerLastName.eGainAttribute = "last_name";
  customerLastName.eGainValue = LastName;
  customerLastName.eGainParamName = "last_name";
  customerLastName.eGainMinLength = "1";
  customerLastName.eGainMaxLength = "50";
  customerLastName.eGainRequired = "1";
  customerLastName.eGainFieldType = "1";
  customerLastName.eGainPrimaryKey = "0";
  customerLastName.eGainValidationString = "";
  customerObject.AddCustomerParameter(customerLastName);

  var customerEmail = new myLibrary.Datatype.CustomerParameter();
  customerEmail.eGainParentObject = "casemgmt";
  customerEmail.eGainChildObject = "email_address_contact_point_data";
  customerEmail.eGainAttribute = "email_address";
  customerEmail.eGainValue = EmailAddress;
  customerEmail.eGainParamName = "email_address";
  customerEmail.eGainMinLength = "1";
  customerEmail.eGainMaxLength = "50";
  customerEmail.eGainRequired = "1";
  customerEmail.eGainFieldType = "1";
  customerEmail.eGainPrimaryKey = "1";
  customerEmail.eGainValidationString = "";
  customerObject.AddCustomerParameter(customerEmail);

  var customerPhone = new myLibrary.Datatype.CustomerParameter();
  customerPhone.eGainParentObject = "casemgmt";
  customerPhone.eGainChildObject = "phone_number_data";
  customerPhone.eGainAttribute = "phone_number";
  customerPhone.eGainValue = PhoneNumber;
  customerPhone.eGainParamName = "phone_number";
  customerPhone.eGainMinLength = "1";
  customerPhone.eGainMaxLength = "18";
  customerPhone.eGainRequired = "1";
  customerPhone.eGainFieldType = "1";
  customerPhone.eGainPrimaryKey = "1";
  customerPhone.eGainValidationString = "";
  customerObject.AddCustomerParameter(customerPhone);

  /* Now call the Chat initiliaztion method with your entry point and callbacks */
  /* Now create an instance of the Chat Object */
  //myChat = myLibrary.myChat;
  /* Next get the event handlers for chat. It is mandatory to provide definition for the mandatory event handlers before initializing chat */
  //myEventHandlers = myChat.GetEventHandlers();

  try {
    /* Now create an instance of the Chat Object */
    const myChat = new myLibrary.Chat();
    /* Next get the event handlers for chat. It is mandatory to provide definition for the mandatory event handlers before initializing chat */
    const myEventHandlers = createEventHandlers(myChat, session)

    myChat.Initialize(ChatEntryPointId, 'en', 'US', myEventHandlers, 'aqua', 'v11');
    /*Now set the customer */
    myLibrary.SetCustomer(customerObject);
    myChat.Start()
    // add reference to ECE session in the session global
    session.eceSession = myChat
    session.escalated = true
  } catch (e) {
    console.error('error starting ECE chat', e)
  }
}

function createEventHandlers (myChat, session) {
  let myEventHandlers = myChat.GetEventHandlers()
  /* Example browser alert when chat is connected */
  myEventHandlers.OnConnectSuccess = function (args) {
    console.log('OnConnectSuccess', args)
    var welcomeMessage = "You are now connected to an Expert.";
    console.log("You are now connected to an Agent " + welcomeMessage);
    session.messages.push({
      text: welcomeMessage,
      type: 'system',
      datetime: new Date().toJSON()
    })
  };
  /* Example browser alert when there is a connection failure */
  myEventHandlers.OnConnectionFailure = function (args) {
    console.log('OnConnectionFailure', args)
    // console.log('Oops! Something went wrong');
  };
  /* Example output of agent messages to a DIV named TransScript with jQuery */
  myEventHandlers.OnAgentMessageReceived = function (args) {
    console.log('OnAgentMessageReceived', args)
    console.log("Agent Message Received: " + args.Message);
    session.messages.push({
      text: args.Message,
      type: 'agent',
      datetime: new Date().toJSON()
    })
  };
  /* Example output of system messages to the same DIV */
  myEventHandlers.OnSystemMessageReceived = function (args) {
    console.log("System Message Received: " + args.Message)
    session.messages.push({
      text: args.Message,
      type: 'system',
      datetime: new Date().toJSON()
    })
  }
  /* Example browser console.log when an error occurs */
  myEventHandlers.OnErrorOccurred = function (args) {
    console.log('Oops! Error Occurred' + args.toString());
    session.messages.push({
      text: args.toString(),
      type: 'system',
      datetime: new Date().toJSON()
    })
  };
  /* Example browser console.log when agents are not available */
  myEventHandlers.OnAgentsNotAvailable = function (args) {
    console.log('Sorry no agents available', args);
    session.messages.push({
      text: args.toString(),
      type: 'system',
      datetime: new Date().toJSON()
    })
  };
  /* Example browser console.log when the chat is completed */
  myEventHandlers.OnConnectionComplete = function () {
    console.log("Connection Complete!")
    // end ECE session
    session.eceSession.End()
    // remove escalated flag
    session.escalated = false
  };
  /* Example of adding message in transcript when customer attachment invite is sent to server */
  myEventHandlers.OnCustomerAttachmentNotificationSent = function (args) {
    console.log('OnCustomerAttachmentNotificationSent', args)
    const message = "Waiting for agent to accept attachment"
    session.messages.push({
      text: message,
      type: 'system',
      datetime: new Date().toJSON()
    })
  }
  /* Example of uploading attachment to chat server when agent accepts attachment invite */
  myEventHandlers.OnAttachmentAcceptedByAgent = function (args) {
    file.uniqueFileId = args.uniqueFileId
    myChat.UploadAttachment(file, args.agentName)
    session.messages.push({
      text: 'agent has accepted attachment',
      type: 'system',
      datetime: new Date().toJSON()
    })
  };

  /* Example of sending notification to chat server when customer accepts attachment invite */
  myEventHandlers.OnAttachmentInviteReceived = function(args){
    var acceptBtn = document.createElement('input');
    acceptBtn.type = "button";
    acceptBtn.value = "Accept";
    acceptBtn.addEventListener('click', function(){
      sendAcceptChatAttachmentNotification(args.Attachment);
    });
    // $('#messages ul').append( '<li><span class="systemmsg-chat">' + args.Attachment.AgentName + " has sent attachment "+args.Attachment.Name + '</span><div class="clear"></div></li>');
    // $('#messages ul').append(acceptBtn);
  };

  /* Example of downloading file when attachment is fetched from server */
  myEventHandlers.OnGetAttachment = function(AgentAttachmentArgs){
    if (typeof fileName !== 'undefine' && fileName !== null) {
      if ((/\.(gif|jpg|jpeg|tiff|png)$/i).test(fileName)) {
        myChat.GetAttachmentImage(AgentAttachmentArgs.fileId,AgentAttachmentArgs.uniqueFileId);
      }
      else{
        var data = AgentAttachmentArgs.data;
        var blob = new Blob([data]);
        url = window.URL || window.webkitURL;
        var fileUrl = url.createObjectURL(blob);
        window.open(fileUrl);
      }
    }

  };
  /* Example of downloading file when attachment thumbnail is fetched from server */
  myEventHandlers.OnGetAttachmentImageThumbnail = function(thumbnailArgs){
    var thumbnailElement = document.createElement('img');
    thumbnailElement.src = thumbnailArgs.data;
    $('#messages ul').append("<br />");
    $('#messages ul').append(thumbnailElement);
  };

  function sendAcceptChatAttachmentNotification(attachment){
    fileName = attachment.Name;
    myChat.SendAcceptChatAttachmentNotification(attachment.Id,attachment.Name);
    myChat.GetAttachment(attachment.Id);
  };

  return myEventHandlers
}
