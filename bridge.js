var wrtc = require('wrtc');

function WebRTCBridge () {
  this.pendingDataChannels = {};
  this.dataChannels = {}
  this.pc = null;

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

  this.answerCreatedHandlers = [];
  this.localIceCandidateHandlers = [];
  this.dataChannelHandlers = [];

  this.channelMessageHandlers = {};

  this.RTCPeerConnection = wrtc.RTCPeerConnection;
  this.RTCSessionDescription = wrtc.RTCSessionDescription;
  this.RTCIceCandidate = wrtc.RTCIceCandidate;

  this.dataChannelSettings = {
    'reliable': {
      ordered: false,
      maxRetransmits: 0
    },
  };
}

WebRTCBridge.prototype.recvOffer = function (data) {
  var offer = new this.RTCSessionDescription(data);
  this.localOrRemoteDescSet = false;

  this.pc = new this.RTCPeerConnection(
    {
      iceServers: [{url:'stun:stun.l.google.com:19302'}]
    },
    {
      'optional': [{DtlsSrtpKeyAgreement: false}]
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
  this.pc.onicecandidate = function(event) {
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
    } else {
      candidate = event.candidate;
    }
    peer._xferIceCandidate(candidate);
  }

  this._doCreateDataChannelCallback(offer);
};

WebRTCBridge.prototype._doCreateDataChannelCallback = function (offer) {
  var labels = Object.keys(this.dataChannelSettings);

  console.log("Handling data channels");

  var peer = this;

  this.pc.ondatachannel = function(evt) {
    var channel = evt.channel;

    console.log('ondatachannel', channel.label, channel.readyState);
    var label = channel.label;
    peer.pendingDataChannels[label] = channel;
    channel.binaryType = 'arraybuffer';
    channel.onopen = function() {
      console.info('onopen');
      peer.dataChannels[label] = channel;
      delete peer.pendingDataChannels[label];
      if(Object.keys(peer.dataChannels).length === labels.length) {
        peer._doAllDataChannelsOpen();
      }

      peer.dataChannelHandlers.forEach(function (handler) {
        handler(channel);
      });
    };
    if (channel.readyState == "open") {
      // Manully open the channel in case it was created in the open state.  If
      // that happens, we don't set the "onopen" until later, so it will never
      // be called.  Therefore, we detect that case and call it here.
      channel.onopen();
      channel.onopen = undefined;
    }

    channel.onmessage = function(evt) {
      var data = evt.data;
      console.log('onmessage:', evt.data);

      peer.channelMessageHandlers[channel.label].forEach(function (handler) {
        handler(channel, data);
      });
    };

    channel.onclose = function() {
      console.info('onclose');
    };

    channel.onerror = peer._doHandleError.bind(peer);
  };

  this._doSetRemoteDesc(offer);
};

WebRTCBridge.prototype._doSetRemoteDesc = function (offer) {
  console.info(offer);
  var peer = this;
  this.pc.setRemoteDescription(
    offer,
    peer._doCreateAnswer.bind(peer),
    peer._doHandleError.bind(peer)
  );
};

WebRTCBridge.prototype._doCreateAnswer = function () {
  this.localOrRemoteDescSet = true;
  var peer = this;
  this.inboundIceCandidates.forEach(function(candidate) {
    peer.pc.addIceCandidate(new peer.RTCIceCandidate(candidate.sdp));
  });
  this.inboundIceCandidates = [];
  this.pc.createAnswer(
    peer._doSetLocalDesc.bind(peer),
    peer._doHandleError.bind(peer)
  );
};

WebRTCBridge.prototype._doSetLocalDesc = function (desc) {
  var answer = desc;
  console.info("DESC:: ", desc);
  var peer = this;
  this.pc.setLocalDescription(
    desc,
    peer._doSendAnswer.bind(peer, answer),
    peer._doHandleError.bind(peer)
  );
};

WebRTCBridge.prototype._doSendAnswer = function (answer) {
  console.log("Sending answer:", answer);
  var peer = this;
  this.answerCreatedHandlers.forEach(function(handler) {
    handler(answer);
  });
  console.log("Awaiting data channels");
};

WebRTCBridge.prototype.recvRemoteIceCandidate = function (data) {
  if (this.localOrRemoteDescSet) {
    this.pc.addIceCandidate(new this.RTCIceCandidate(data.sdp.candidate));
  } else {
    this.inboundIceCandidates.push(data);
  }
};

WebRTCBridge.prototype.addLocalIceCandidateHandler = function (handler) {
  this.localIceCandidateHandlers.push(handler);
};

WebRTCBridge.prototype._xferIceCandidate = function (candidate) {
  var iceCandidate = {
    'type': 'ice',
    'sdp': {
      'candidate': candidate.candidate,
      'sdpMid': candidate.sdpMid,
      'sdpMLineIndex': candidate.sdpMLineIndex
    }
  };

  console.info(JSON.stringify(iceCandidate));

  this.localIceCandidateHandlers.forEach(function (handler) {
    handler(iceCandidate);
  });
};

WebRTCBridge.prototype._doAllDataChannelsOpen = function () {
  console.info('complete');
};

WebRTCBridge.prototype._doHandleError = function (error) {
  throw error;
}

WebRTCBridge.prototype.addDataChannelHandler = function (handler) {
  this.dataChannelHandlers.push(handler);
};


WebRTCBridge.prototype.addChannelMessageHandler = function (channel, handler) {
  if (typeof this.channelMessageHandlers[channel.label] == "undefined") {
    this.channelMessageHandlers[channel.label] = [];
  }
  this.channelMessageHandlers[channel.label].push(handler);
};

WebRTCBridge.prototype.addAnswerCreatedHandler = function (handler) {
  this.answerCreatedHandlers.push(handler);
};


var static = require('node-static-alias');
var http = require('http');
var ws = require('ws');

var args = require('minimist')(process.argv.slice(2));
var host = args.h || '127.0.0.1';
var port = args.p || 8080;
var socketPort = args.ws || 9001;

var file = new static.Server('./', {
    alias: {
        match: '/dist/wrtc.js',
        serve: 'node_modules/wrtc/dist/wrtc.js',
        allowOutside: true
      }
    });

var app = http.createServer(function (req, res) {
    console.log(req.url);
    req.addListener('end', function() {
        file.serve(req, res);
      }).resume();

}).listen(port, host);
console.log('Server running at http://' + host + ':' + port + '/');

var wss = new ws.Server({'port': socketPort});
wss.on('connection', function(ws) {
  console.info('~~~~~ ws connected ~~~~~~');

  var peer = new WebRTCBridge();

  peer.addLocalIceCandidateHandler(function (iceCandidate) {
    ws.send(JSON.stringify(iceCandidate));
  });

  peer.addAnswerCreatedHandler(function (answer) {
    ws.send(JSON.stringify(answer));
  });

  peer.addDataChannelHandler(function (channel) {
    peer.addChannelMessageHandler(channel, function (channel, data) {
      if('string' == typeof data) {
        channel.send("Hello peer!");
      } else {
        var response = new Uint8Array([107, 99, 97, 0]);
        channel.send(response.buffer);
      }
    });
  });

  ws.on('message', function(data) {
    data = JSON.parse(data);
    if('offer' == data.type) {
      peer.recvOffer(data);
    } else if('ice' == data.type) {
      peer.recvRemoteIceCandidate(data);
    }
  });
});
