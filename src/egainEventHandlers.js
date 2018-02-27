function create (myChat, session) {
  let myEventHandlers = myChat.GetEventHandlers()

  myEventHandlers.OnConnectionInitialized = function (args) {
    console.log('OnConnectionInitialized', args)
  }
  myEventHandlers.OnConnectionPaused = function (args) {
    console.log('OnConnectionPaused', args)
  }
  myEventHandlers.OnConnectionResumed = function (args) {
    console.log('OnConnectionResumed', args)
  }
  myEventHandlers.OnConnectionAttached = function (args) {
    console.log('OnConnectionAttached', args)
  }
  myEventHandlers.OnConnectionAttachedFailure = function (args) {
    console.log('OnConnectionAttachedFailure', args)
  }
  myEventHandlers.OnDuplicateSession = function (args) {
    console.log('OnDuplicateSession', args)
  }
  myEventHandlers.OnSysemMessageReceived = function (args) {
    console.log('OnSysemMessageReceived', args)
  }
  myEventHandlers.OnGetQueueCurrentStatus = function (args) {
    console.log('OnGetQueueCurrentStatus', args)
  }
  myEventHandlers.OnMessagePropertyLoad = function (args) {
    console.log('OnMessagePropertyLoad', args)
  }
  myEventHandlers.OnErrorOccured = function (args) {
    console.log('OnErrorOccured', args)
  }


  /* Example browser alert when chat is connected */
  myEventHandlers.OnConnectSuccess = function (args) {
    console.log('OnConnectSuccess', args)
    var welcomeMessage = "Ok, I'll get you connected to one of our Experts. One moment...";
    console.log(welcomeMessage);
    session.addMessage('system', welcomeMessage)
  }
  /* Example browser alert when there is a connection failure */
  myEventHandlers.OnConnectionFailure = function (args) {
    console.log('OnConnectionFailure', args)
    // console.log('Oops! Something went wrong');
    session.addMessage('system', 'Sorry, we are unable to get an expert to help you at this time. Please try again later.')
  };
  /* Example output of agent messages to a DIV named TransScript with jQuery */
  myEventHandlers.OnAgentMessageReceived = function (args) {
    console.log('OnAgentMessageReceived', args)
    console.log("Agent Message Received: " + args.Message)
    session.addMessage('agent', args.Message)
  };
  /* Example output of system messages to the same DIV */
  myEventHandlers.OnSystemMessageReceived = function (args) {
    console.log("System Message Received: " + args.Message)
    session.addMessage('system', args.Message)
  }
  /* Example browser console.log when an error occurs */
  myEventHandlers.OnErrorOccurred = function (args) {
    console.log('Oops! Error Occurred' + args.toString());
    session.addMessage('system', args.toString())
  }
  /* Example browser console.log when agents are not available */
  myEventHandlers.OnAgentsNotAvailable = function (args) {
    console.log('Sorry no agents available', args);
    session.addMessage('system', args.toString())
  };
  /* Example browser console.log when the chat is completed */
  myEventHandlers.OnConnectionComplete = function () {
    console.log("Chat with eGain agent complete.")
    session.deescalate()
  };
  /* Example of adding message in transcript when customer attachment invite is sent to server */
  myEventHandlers.OnCustomerAttachmentNotificationSent = function (args) {
    console.log('OnCustomerAttachmentNotificationSent args =', args)
    const message = "Waiting for agent to accept attachment"
    // send command for sparky-ui chat client to accept
    session.addMessage('system', message)
    session.addCommand('accept-attachment')
  }
  /* Example of uploading attachment to chat server when agent accepts attachment invite */
  myEventHandlers.OnAttachmentAcceptedByAgent = function (args) {
    console.log('OnAttachmentAcceptedByAgent args =', args)
    // TODO implement something else here?
    // file.uniqueFileId = args.uniqueFileId
    // myChat.UploadAttachment(file, args.agentName)
    session.addMessage('system', 'agent has accepted attachment')
  }

  /* Example of sending notification to chat server when customer accepts attachment invite */
  myEventHandlers.OnAttachmentInviteReceived = function (args) {
    console.log('OnAttachmentInviteReceived args =', args)
    session.addMessage('system', `${args.Attachment.AgentName} has sent you a file: ${args.Attachment.Name}`)
    // var acceptBtn = document.createElement('input');
    // acceptBtn.type = "button";
    // acceptBtn.value = "Accept";
    // acceptBtn.addEventListener('click', function () {
    //   sendAcceptChatAttachmentNotification(args.Attachment);
    // });
    // $('#messages ul').append( '<li><span class="systemmsg-chat">' + args.Attachment.AgentName + " has sent attachment "+args.Attachment.Name + '</span><div class="clear"></div></li>');
    // $('#messages ul').append(acceptBtn);
  };

  /* Example of downloading file when attachment is fetched from server */
  myEventHandlers.OnGetAttachment = function(args){
    // if (typeof fileName !== 'undefine' && fileName !== null) {
    //   if ((/\.(gif|jpg|jpeg|tiff|png)$/i).test(fileName)) {
    //     myChat.GetAttachmentImage(args.fileId, args.uniqueFileId);
    //   }
    //   else{
    //     var data = args.data;
    //     var blob = new Blob([data]);
    //     url = window.URL || window.webkitURL;
    //     var fileUrl = url.createObjectURL(blob);
    //     window.open(fileUrl);
    //   }
    // }

  }
  /* Example of downloading file when attachment thumbnail is fetched from server */
  myEventHandlers.OnGetAttachmentImageThumbnail = function(args){
    // var thumbnailElement = document.createElement('img');
    // thumbnailElement.src = args.data;
    // $('#messages ul').append("<br />");
    // $('#messages ul').append(thumbnailElement);
    console.log('OnGetAttachmentImageThumbnail args =', args)
    console.log('OnGetAttachmentImageThumbnail src =', args.src)
    session.addCommand('show-thumbnail', args.src)
  }

  // function sendAcceptChatAttachmentNotification(attachment){
  //   fileName = attachment.Name
  //   myChat.SendAcceptChatAttachmentNotification(attachment.Id, attachment.Name)
  //   myChat.GetAttachment(attachment.Id)
  // };

  return myEventHandlers
}

module.exports = {create}