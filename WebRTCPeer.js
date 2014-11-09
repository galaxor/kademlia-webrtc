if (typeof require == "function") {
  // If we've been called from nodejs, then 'require' will be a function, and
  // we can/have to require the wrtc module.
  // If we've come from a browser, then 'require' doesn't exist, and we'll just
  // have to hope that they've been given wrtc's dist/wrtc.js in a previous
  // <script> tag, which will define wrtc.
  var wrtc = require('wrtc');
}

/**
 * An object that facilitates WebRTC dataChannel communication.
 * In WebRTC, the connection must be established through some means other than
 * WebRTC, and the peers can only communicate with each other once the
 * connection is established.
 * Specifically, an "Offer" must be created by Alice and communicated to Bob somehow.
 * An "Answer" must be created by Bob and communicated to Alice somehow.
 * Meanwhile, both Alice and Bob are creating "ICE Candidates" - Communication
 * details on how they can be reached, through NATs and so forth.  These must
 * be communicated from one side to the other somehow.
 * RTC communication can only proceed once the offer and answer are sent, and
 * the ICE candidates are sent.
 * This object facilitates all that sort of communication, so you can get more
 * easily down to the business of making your peers communicate through
 * dataChannels.
 *
 * The constructor is where you can pass a bunch of the callbacks that make this run.
 * The args object has these members.
 *
 * sendOffer: function (peer, offer)
 *   This callback is called after an offer is created by the local side (as a
 *   result of a call to createOffer).  This callback must somehow send the
 *   offer to the remote side.
 *
 * sendAnswer: function (peer, answer)
 *   This callback is called after an answer is created by the local side (as a
 *   result of a call to recvOffer).  This callback must somehow send the
 *   answer to the remote side.
 *
 * sendLocalIce: function (peer, iceCandidate)
 *   This callback is called when a local ICE candidate is created.  The
 *   callback must somehow send the ICE candidate to the remote side.
 *
 * iceXferReady: function (peer)
 *   The local side may start to generate ICE candidates before we are ready to send them.
 *   For example, if we are sending our ICE candidates over WebSocket, then
 *   perhaps we have not yet established the WebSocket connection.
 *   This callback should return TRUE if we are ready to start calling
 *   sendLocalIce, and should return FALSE if we are not ready.
 * 
 * expectedDataChannels:
 *   This is an object.  Each key is the label of a dataChannel we expect the
 *   remote side to open.
 *   The key may have two types of values:  An object or a function.
 *   If it's an object, then we expect two keys:
 *     onMessage:  function (peer, channel, data)
 *       A callback to run when there is a message on this channel.
 *     onOpen: function (peer, channel)
 *       A callback to run when this channel is opened for the first time.
 *   If the value for this expected datachannel is a function rather than an
 *   object, then it specifies the onMessage callback:  function (channel,
 *   data).
 *   If the remote side attempts to open a dataChannel that has a label we were
 *   not expecting, we will ignore it.
 *   If no expectedDataChannels are passed, then we will allow the remote side
 *   to open any dataChannels.  However, no callbacks will be registered unless
 *   we later call addChannelMessageHandler or addDataChannelHandler.
 *
 * createDataChannels:
 *   This is an object.  Each key is the label of a dataChannel that we will
 *   open as soon as communication is established with the remote side.
 *   The value is an object containing dataChannel parameters and callbacks.
 *   The arguments will be passed verbatim to the underlying createDataChannel
 *   function, so they should be as specified here:
 *    https://w3c.github.io/webrtc-pc/#widl-RTCPeerConnection-createDataChannel-RTCDataChannel-DOMString-label-RTCDataChannelInit-dataChannelDict
 *   The callbacks are:
 *     onMessage:  function (peer, channel, data)
 *       A callback to run when there is a message on this channel.
 *     onOpen: function (peer, channel)
 *       A callback to run when this channel is opened for the first time.
 *
 * unexpectedDataChannel: function (peer, channel)
 *   This callback is called when the remote side attempts to open a
 *   dataChannel that we did not list in expectedDataChannels.  If we did not
 *   list anything in expectedDataChannels, this will never be called.
 *
 * Once all the callbacks are in place, it is time to start communications.
 * You may initiate communication with a call to createOffer().  If you
 * do this, you will get an answer from the remote side (somehow; this is one
 * of the things that WebRTC does not specify).  When you do, call
 * recvAnswer(answer) to start communications.
 * You may also not be the initiator of communication.  In that case, wait to
 * receive an offer (somehow; not specified in WebRTC), and then call
 * recvOffer(offer).
 *
 * Once the dataChannels are open, you can call send(label, message), which
 * will send the message on the dataChannel that has that label.
 */
function WebRTCPeer (args) {
  // This is the WebRTCPeerconnection object.
  this.pc = null;

  // - Data channel things -

  // This defines what data channels we expect the remote side to open.
  // If it's empty, we will allow the remote side to open any data channels.
  // But if there are expected data channels set (by addExpectedDataChannels),
  // and the remote side tries to open one with a different name, we will
  // reject it.
  this.expectedDataChannels = {};
  this.unexpectedDataChannelCallbacks = [];

  if (typeof args != "undefined" && typeof args.unexpectedDataChannel != "undefined") {
    this.addUnexpectedDataChannelCallback(args.unexpectedDataChannel);
  }

  // These are called when a message is received on a channel.  The handlers
  // for the appropriate dataChannel are called.
  this.channelMessageHandlers = {};

  // These are fired when a data channel is opened.  An application can use
  // this to initiate communication or prepare to receive communication.
  this.dataChannelHandlers = {};

  // These are fired when a data channel is closed.
  this.dataChannelCloseHandlers = {};

  if (typeof args != "undefined" && typeof args.expectedDataChannels != "undefined") {
    this.addExpectedDataChannels(args.expectedDataChannels);
  }

  // This is the list of data channels we want to create.  We will create them
  // once we've been asked to create the offer or answer.
  this.dataChannelSettings = {};

  if (typeof args != "undefined" && typeof args.createDataChannels != "undefined") {
    this.dataChannelSettings = args.createDataChannels;
  }

  // This collects the datachannel objects after they are created but before they are open.
  this.pendingDataChannels = {};

  // This collects the datachannel objects after they are open.
  this.dataChannels = {};


  // - ICE candidate things - 

  // ICE Candidate queues.
  // We can't accept inbound ICE candidates until we've setRemoteDescription.
  // We can't send outbound ICE candidates until our external, non-webrtc
  // communication channel is open, whatever that may be.

  // Inbound:  They may start sending us ICE candidates before we're ready.
  // We're ready once we've setLocalDescription or setRemoteDescription.
  // Before that happens, queue the ICE candidates.
  this.inboundIceCandidates = [];

  // This variable keeps track of whether we've set the local desc or remote
  // desc.  If it is false, we must continue queueing inbound ICE candidates.
  // If it is true, we can start adding them to the peerConnection right away.
  // Also, once we've set the local or remote description, we will add all the
  // ICE candidates in the queue.
  this.localOrRemoteDescSet = false;

  // Outbound:  We may start generating ICE candidates before we're ready to send them.
  // For example, if we are the one to send the offer, we may
  // setLocalDescription before our external comm channel is open (possibly
  // websocket).  If we start generating ICE candidates before we're ready to
  // send them, start queueing them.
  this.outboundIceCandidates = [];

  // We can only transfer ice candidates if the external channel is open.  This
  // is not something that's within the scope of webrtc.  Therefore, we defer
  // to the application to tell us when we're ready to transfer ICE candidates.
  // They are allowed to register callbacks.  Whenever we get an ICE candidate,
  // we will check to see if the comm channel is ready.  If not, we add the ICE
  // candidate to the outbound queue.
  // Also, we expect the application to call sendPendingIceCandidates when the
  // comm channel opens.
  this.iceXferReadyCallbacks = [];

  if (typeof args != "undefined" && typeof args.iceXferReady != "undefined") {
    this.addIceXferReadyCallback(args.iceXferReady);
  }

  // - Event handler queues -
  // The application can register handlers for certain events.  They are
  // collected in these queues.

  // These are fired when we create the WebRTC answer.  The application can
  // register handlers that should probably do something to send the answer we
  // created back to the other WebRTC peer, so we can establish communication.
  this.sendAnswerHandlers = [];

  if (typeof args != "undefined" && typeof args.sendAnswer != "undefined") {
    this.addSendAnswerHandler(args.sendAnswer);
  }

  // These are fired when we are ready to send an ICE candidate to the other WebRTC peer.
  // The application does not need to worry about such things ans outbound ICE
  // candidate queues.  These handlers are called only when we are actually
  // ready to send the local ICE candidates.
  this.sendLocalIceCandidateHandlers = [];

  if (typeof args != "undefined" && typeof args.sendLocalIce != "undefined") {
    this.addSendLocalIceCandidateHandler(args.sendLocalIce);
  }

  this.dataChannelsOpenCallbacks = [];

  this.sendOfferHandlers = [];

  if (typeof args != "undefined" && typeof args.sendOffer != "undefined") {
    this.addSendOfferHandler(args.sendOffer);
  }

  // - Bring the standard WebRTC components into our namespace -
  // At the time of writing, both firefox and chromium keep their WebRTC
  // functions prefixed.  Furthermore, the nodejs wrtc functions are always in
  // the module's namespace.  No matter where they are, let's make them
  // functions belonging to this class, so we know where to find them.
  this.RTCPeerConnection = wrtc.RTCPeerConnection;
  this.RTCSessionDescription = wrtc.RTCSessionDescription;
  this.RTCIceCandidate = wrtc.RTCIceCandidate;
}

/**
 * Create an offer of WebRTC communication.
 * This function takes no arguments.  All the callbacks for sending the offer
 * to the remote side and responding to data channels and ICE candidates, etc.
 * should be set already by the time this is called.  Most likely, in the
 * constructor, but also possibly by add*Handler calls.
 * Sometime after creating the offer, your application will receive an answer.
 * Call recvAnswer(answer) when you do.
 */
WebRTCPeer.prototype.createOffer = function (createDataChannels) {
  var peer = this;
  this.pc = new this.RTCPeerConnection(
    {
      iceServers: [{url:'stun:stun.l.google.com:19302'}]
    },
    {
      'optional': [],
    }
  );

  if (typeof createDataChannels != 'undefined') {
    peer.dataChannelSettings = createDataChannels;
  }
  
  this.pc.onsignalingstatechange = function(event) {
    console.info('signaling state change:', event);
  };
  this.pc.oniceconnectionstatechange = function(event) {
    console.info("ice connection state change: ", event.target.iceConnectionState);
  };
  this.pc.onicegatheringstatechange = function(event) {
    console.info("ice gathering state change: ", event.target.iceGatheringState);
  };
  this.pc.onicecandidate = this._onIceCandidate.bind(this);

  this._doCreateDataChannelCallback();
  this._doCreateDataChannels();
  this._doCreateOffer();
};

/**
 * Receive an answer that was sent by the remote side.
 * 
 */
WebRTCPeer.prototype.recvAnswer = function (desc) {
  var peer = this;
  this.pc.setRemoteDescription(
    new peer.RTCSessionDescription(desc),
    peer._doWaitforDataChannels.bind(peer),
    peer._doHandleError.bind(peer)
  );
};

/**
 * Receive an offer that was sent from the remote side.
 * All the callbacks for sending the answer and sending ICE candidates and so
 * forth should have been set up by the time this is called, probably in the
 * constructor.
 */
WebRTCPeer.prototype.recvOffer = function (data) {
  var offer = new this.RTCSessionDescription(data);
  this.localOrRemoteDescSet = false;

  this.pc = new this.RTCPeerConnection(
    {
      iceServers: [{url:'stun:stun.l.google.com:19302'}]
    },
    {
      'optional': []
    }
  );

  this.pc.onsignalingstatechange = function(event) {
    console.info('signaling state change:', event);
  };
  this.pc.oniceconnectionstatechange = function(state) {
    console.info('ice connection state change:', state);
  };
  this.pc.onicegatheringstatechange = function(state) {
    console.info('ice gathering state change:', state);
  };

  var peer = this;
  this.pc.onicecandidate = this._onIceCandidate.bind(this);

  this._doCreateDataChannelCallback();

  this.pc.setRemoteDescription(
    offer,
    peer._doCreateAnswer.bind(peer),
    peer._doHandleError.bind(peer)
  );
};

/**
 * Send the message on the dataChannel that bears that label.
 */
WebRTCPeer.prototype.send = function (label, message) {
  this.dataChannels[label].send(message);
}

WebRTCPeer.prototype._iceXferReady = function () {
  var peer = this;
  var ready = true;
  this.iceXferReadyCallbacks.every(function (cb) {
    ready = cb(peer);
    return ready;
  });
  return ready;
};

/**
 * Let the application register callbacks to tell us if the external comm
 * channel is open and ready to send ICE candidates.
 */
WebRTCPeer.prototype.addIceXferReadyCallback = function (cb) {
  this.iceXferReadyCallbacks.push(cb);
};

/**
 * Let the application set which data channel labels to expect.
 * If there are no expectations, any data channel that opens is okay.
 * If there are expected data channels, and an unexpected data channel opens,
 * it will not have any callbacks on it, and the application may register a
 * callback for the situation of rejecting a data channel.
 * There are three forms for calling this:
 *  addExpectedDataChannels(['label1', 'label2'])
 *  addExpectedDataChannels({label1: callback, label2: callback})
 *  addExpectedDataChannels({label1: {onOpen: function (channel), onMessage: function (channel, message)}, ...})
 */
WebRTCPeer.prototype.addExpectedDataChannels = function () {
  var label;

  if (typeof arguments[0] == "object") {
    var arg = arguments[0];
    for (var i in arg) {
      label = i;
      var onOpen = null;
      var onMessage = null;

      if (typeof arg[i] == "function") {
        onMessage = arg[i];
      } else {
        onOpen = arg[i].onOpen;
        onMessage = arg[i].onMessage;
      }

      this.expectedDataChannels[label] = true;
      if (onOpen) {
        this.addDataChannelHandler(label, onOpen);
      }
      if (onMessage) {
        this.addChannelMessageHandler(label, onMessage);
      }
    }
  } else {
    for (var i=0; i<arguments.length; i++) {
      label = arguments[i];
      this.expectedDataChannels[label] = true;
    }
  }
};

/**
 * Register a callback to call when the remote side attempts to open a
 * dataChannel that is not listed in expectedDataChannels.
 * @param cb function (channel)
 */
WebRTCPeer.prototype.addUnexpectedDataChannelCallback = function (cb) {
  this.unexpectedDataChannelCallbacks.push(cb);
};

WebRTCPeer.prototype._onIceCandidate = function (event) {
  var peer = this;
  var candidate;

  // In some webrtc implementations (firefox, chromium), the argument will be
  // an "event", which will have a key "candidate", which is the ICE
  // candidate.  In others (nodejs), the argument will be just the ICE
  // candidate object itself.
  // But we can't use the presence of a "candidate" key as the test of
  // eventhood, because the ICE candidate object itself also has a key called
  // "candidate".
  if (typeof event.target == "undefined") {
    candidate = event;
    if (typeof candidate.candidate != "undefined" && candidate.candidate == null) { return; }
    if (typeof candidate.candidate != "undefined" && typeof candidate.candidate.candidate != "undefined") {
      candidate = candidate.candidate;
    }
  } else {
    candidate = event.candidate;
  }

  // Apparently, having a null candidate is something that can happen sometimes.
  // Don't put the burden on the remote side to ignore that garbage.
  if(!candidate) return;

  if (peer._iceXferReady()) {
    peer._xferIceCandidate(candidate);
  } else {
    peer.outboundIceCandidates.push(candidate);
  }
};

WebRTCPeer.prototype._doCreateOffer = function () {
  var peer = this;
  this.pc.createOffer(
    function (offer) {
      peer.pc.setLocalDescription(
        new peer.RTCSessionDescription(offer),
        peer._doSendOffer.bind(peer, offer),
        peer._doHandleError.bind(peer)
      );
    },
    this._doHandleError.bind(peer)
  );
};

WebRTCPeer.prototype._doSendOffer = function (offer) {
  var peer = this;
  this.localOrRemoteDescSet = true;
  this.inboundIceCandidates.forEach(function(candidate) {
    peer.pc.addIceCandidate(new peer.RTCIceCandidate(candidate.sdp));
  });

  var offerObj = {
    'type': offer.type,
    'sdp': offer.sdp,
  };

  this.sendOfferHandlers.forEach(function (handler) {
    handler(peer, offerObj);
  });
};

WebRTCPeer.prototype.addSendOfferHandler = function (handler) {
  this.sendOfferHandlers.push(handler);
};

WebRTCPeer.prototype._doWaitforDataChannels = function () {
  console.log('awaiting data channels');
};

WebRTCPeer.prototype._dataChannelOpen = function (channel) {
  var peer = this;
  var label = channel.label;
  var labels = Object.keys(this.expectedDataChannels);

  console.info('onopen');
  peer.dataChannels[label] = channel;
  delete peer.pendingDataChannels[label];
  if (labels.length > 0 && Object.keys(peer.dataChannels).length === labels.length) {
    peer._doAllDataChannelsOpen();
  }

  if (typeof peer.dataChannelHandlers[label] != "undefined") {
    peer.dataChannelHandlers[label].forEach(function (handler) {
      handler(peer, channel);
    });
  }
};

WebRTCPeer.prototype._dataChannelClose = function (channel) {
  var peer = this;
  var label = channel.label;
  if (typeof peer.dataChannelCloseHandlers[label] != "undefined") {
    peer.dataChannelCloseHandlers[label].forEach(function (handler) {
      handler(peer, channel);
    });
  }
};

WebRTCPeer.prototype._dataChannelMessage = function (channel, evt) {
  var peer = this;
  var data = evt.data;

  peer.channelMessageHandlers[channel.label].forEach(function (handler) {
    handler(peer, channel, data);
  });
};

WebRTCPeer.prototype._doCreateDataChannelCallback = function () {
  var labels = Object.keys(this.expectedDataChannels);

  console.log("Handling data channels");

  var peer = this;

  this.pc.ondatachannel = function(evt) {
    var channel = evt.channel;

    console.log('ondatachannel', channel.label, channel.readyState);
    var label = channel.label;

    // Reject the dataChannel if we were not expecting it.
    // That is, if we're expecting some channels but not this one.
    if (labels.length > 0 && typeof peer.expectedDataChannels[label] == "undefined") {
      peer.unexpectedDataChannelCallbacks.forEach(function (cb) {
        cb(peer, channel);
      });
      return;
    }

    peer.pendingDataChannels[label] = channel;
    channel.binaryType = 'arraybuffer';
    channel.onopen = peer._dataChannelOpen.bind(peer, channel);

    if (channel.readyState == "open") {
      // Manully open the channel in case it was created in the open state.  If
      // that happens, we don't set the "onopen" until later, so it will never
      // be called.  Therefore, we detect that case and call it here.
      channel.onopen();
      channel.onopen = undefined;
    }

    channel.onmessage = peer._dataChannelMessage.bind(peer, channel);

    channel.onclose = peer._dataChannelClose.bind(peer, channel);

    channel.onerror = peer._doHandleError.bind(peer);
  };
};

WebRTCPeer.prototype._doCreateAnswer = function () {
  var peer = this;

  this.localOrRemoteDescSet = true;
  this.inboundIceCandidates.forEach(function(candidate) {
    peer.pc.addIceCandidate(new peer.RTCIceCandidate(candidate.sdp));
  });

  this._doCreateDataChannels();

  this.inboundIceCandidates = [];
  this.pc.createAnswer(
    function (answer) {
      peer.pc.setLocalDescription(
        answer,
        peer._doSendAnswer.bind(peer, answer),
        peer._doHandleError.bind(peer)
      );
    },
    peer._doHandleError.bind(peer)
  );
};

WebRTCPeer.prototype._doSendAnswer = function (answer) {
  var peer = this;
  this.sendAnswerHandlers.forEach(function(handler) {
    handler(peer, answer);
  });
};

WebRTCPeer.prototype._doCreateDataChannels = function () {
  var peer = this;
  var labels = Object.keys(this.dataChannelSettings);
  labels.forEach(function(label) {
    var channelOptions = peer.dataChannelSettings[label];
    peer.createDataChannel(label, channelOptions);
  });
};

WebRTCPeer.prototype.createDataChannel = function (label, channelOptions) {
  var peer = this;

  var onOpen = null;
  var onClose = null;
  var onMessage = null;

  if (typeof channelOptions.onOpen != "undefined") {
    onOpen = channelOptions.onOpen;
    delete channelOptions.onOpen;
  }
  if (typeof channelOptions.onClose != "undefined") {
    onClose = channelOptions.onClose;
    delete channelOptions.onClose;
  }
  if (typeof channelOptions.onMessage != "undefined") {
    onMessage = channelOptions.onMessage;
    delete channelOptions.onMessage;
  }

  var channel = peer.pendingDataChannels[label] = peer.pc.createDataChannel(label, channelOptions);
  channel.binaryType = 'arraybuffer';

  if (onOpen) {
    peer.addDataChannelHandler(label, onOpen);
  }
  if (onClose) {
    peer.addDataChannelCloseHandler(label, onClose);
  }
  if (onMessage) {
    peer.addChannelMessageHandler(label, onMessage);
  }
  channel.onopen = peer._dataChannelOpen.bind(peer, channel);
  channel.onclose = peer._dataChannelClose.bind(peer, channel);
  channel.onmessage = peer._dataChannelMessage.bind(peer, channel);

  channel.onerror = peer._doHandleError.bind(peer);
};

WebRTCPeer.prototype.recvRemoteIceCandidate = function (data) {
  if (this.localOrRemoteDescSet) {
    var candidate = new this.RTCIceCandidate(data.sdp);
    this.pc.addIceCandidate(candidate);
  } else {
    this.inboundIceCandidates.push(data);
  }
};

WebRTCPeer.prototype.addSendLocalIceCandidateHandler = function (handler) {
  this.sendLocalIceCandidateHandlers.push(handler);
};

WebRTCPeer.prototype._xferIceCandidate = function (candidate) {
  var peer = this;
  var iceCandidate = {
    'type': 'ice',
    'sdp': {
      'candidate': candidate.candidate,
      'sdpMid': candidate.sdpMid,
      'sdpMLineIndex': candidate.sdpMLineIndex
    }
  };

  this.sendLocalIceCandidateHandlers.forEach(function (handler) {
    handler(peer, iceCandidate);
  });
};

WebRTCPeer.prototype._doAllDataChannelsOpen = function () {
  var peer = this;
  console.log('complete');
  this.dataChannelsOpenCallbacks.forEach(function (cb) {
    cb(peer.dataChannels);
  });
};

WebRTCPeer.prototype._doHandleError = function (error) {
  throw error;
}

WebRTCPeer.prototype.addDataChannelHandler = function (label, handler) {
  if (typeof this.dataChannelHandlers[label] == "undefined") {
    this.dataChannelHandlers[label] = [];
  }
  this.dataChannelHandlers[label].push(handler);
};

WebRTCPeer.prototype.addDataChannelCloseHandler = function (label, handler) {
  if (typeof this.dataChannelCloseHandlers[label] == "undefined") {
    this.dataChannelCloseHandlers[label] = [];
  }
  this.dataChannelCloseHandlers[label].push(handler);
};

WebRTCPeer.prototype.addDataChannelsOpenCallback = function (cb) {
  this.dataChannelsOpenCallbacks.push(cb);
};


WebRTCPeer.prototype.addChannelMessageHandler = function (label, handler) {
  if (typeof this.channelMessageHandlers[label] == "undefined") {
    this.channelMessageHandlers[label] = [];
  }
  this.channelMessageHandlers[label].push(handler);
};

WebRTCPeer.prototype.addSendAnswerHandler = function (handler) {
  this.sendAnswerHandlers.push(handler);
};

if (typeof module != "undefined" || typeof exports != "undefined") {
  module.exports = exports = WebRTCPeer;
}
