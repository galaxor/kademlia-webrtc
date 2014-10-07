function WebRTCPeer () {
  this.pendingDataChannels = {};
  this.dataChannels = {};
  this.pendingCandidates = [];
  this.pc = null;

  // We expect you to have included ../dist/wrtc.js via a <script> tag before
  // including this one.  That will give us the definition of wrtc.
  this.RTCPeerConnection = wrtc.RTCPeerConnection;
  this.RTCSessionDescription = wrtc.RTCSessionDescription;
  this.RTCIceCandidate = wrtc.RTCIceCandidate;

  this.dataChannelSettings = {
    'reliable': {
          outOfOrderAllowed: false,
          maxRetransmitNum: 10
        },
  };

  this.iceXferReadyCallbacks = [];
  this.localIceCandidateHandlers = [];
  this.sendOfferHandlers = [];
  this.dataChannelsOpenCallbacks = [];
}

WebRTCPeer.prototype._iceXferReady = function () {
  var ready = null;
  this.iceXferReadyCallbacks.every(function (cb) {
    ready = cb();
    return ready;
  });
  return ready;
};

WebRTCPeer.prototype.addLocalIceCandidateHandler = function (handler) {
  this.localIceCandidateHandlers.push(handler);
};

WebRTCPeer.prototype.addIceXferReadyCallback = function (cb) {
  this.iceXferReadyCallbacks.push(cb);
};

WebRTCPeer.prototype.addSendOfferHandler = function (handler) {
  this.sendOfferHandlers.push(handler);
};

WebRTCPeer.prototype.addDataChannelsReadyCallback = function (cb) {
  this.dataChannelsOpenCallbacks.push(cb);
};

WebRTCPeer.prototype._doHandleError = function (error) {
  throw error;
};

WebRTCPeer.prototype._doAllDataChannelsOpen = function () {
  var peer = this;
  console.log('complete');
  this.dataChannelsOpenCallbacks.forEach(function (cb) {
    cb(peer.dataChannels);
  });
};

WebRTCPeer.prototype._doWaitforDataChannels = function () {
  console.log('awaiting data channels');
};

WebRTCPeer.prototype.init = function () {
  var peer = this;
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
  this.pc.oniceconnectionstatechange = function(event) {
    console.info("ice connection state change: ", event.target.iceConnectionState);
  };
  this.pc.onicegatheringstatechange = function(event) {
    console.info("ice gathering state change: ", event.target.iceGatheringState);
  };
  this.pc.onicecandidate = function(event) {
    var candidate = event.candidate;
    if(!candidate) return;
    if (peer._iceXferReady()) {
      peer._xferIceCandidate(candidate);
    } else {
      peer.pendingCandidates.push(candidate);
    }
  };

  this._doCreateDataChannels();
};

WebRTCPeer.prototype._xferIceCandidate = function (candidate) {
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

WebRTCPeer.prototype._doCreateDataChannels = function () {
  var peer = this;
  var labels = Object.keys(this.dataChannelSettings);
  labels.forEach(function(label) {
    var channelOptions = peer.dataChannelSettings[label];
    var channel = peer.pendingDataChannels[label] = peer.pc.createDataChannel(label, channelOptions);
    console.log(channel);
    channel.binaryType = 'arraybuffer';
    channel.onopen = function() {
      console.info('onopen', label);
      peer.dataChannels[label] = channel;
      delete peer.pendingDataChannels[label];
      if(Object.keys(peer.dataChannels).length === labels.length) {
        peer._doAllDataChannelsOpen();
      }
    };
    channel.onmessage = function(event) {
      var data = event.data;
      if('string' == typeof data) {
        console.log('onmessage:', data);
      } else {
        console.log('onmessage:', new Uint8Array(data));
      }
    };
    channel.onclose = function(event) {
      console.info('onclose');
    };
    channel.onerror = peer._doHandleError.bind(peer);
  });
  this._doCreateOffer();
};

WebRTCPeer.prototype._doCreateOffer = function () {
  var peer = this;
  this.pc.createOffer(
    this._doSetLocalDesc.bind(peer),
    this._doHandleError.bind(peer)
  );
}

WebRTCPeer.prototype._doSetLocalDesc = function (desc) {
  var peer = this;
  this.pc.setLocalDescription(
    new this.RTCSessionDescription(desc),
    this._doSendOffer.bind(peer, desc),
    this._doHandleError.bind(peer)
  );
}

WebRTCPeer.prototype._doSendOffer = function (offer) {
  var peer = this;
  console.log("Sending offer: ", offer);

  var offerObj = {
    'type': offer.type,
    'sdp': offer.sdp,
  };

  this.sendOfferHandlers.forEach(function (handler) {
    handler(offerObj);
  });
};

WebRTCPeer.prototype._doSetRemoteDesc = function (desc) {
  var peer = this;
  this.pc.setRemoteDescription(
    new peer.RTCSessionDescription(desc),
    peer._doWaitforDataChannels.bind(peer),
    peer._doHandleError.bind(peer)
  );
};

WebRTCPeer.prototype.sendPendingIceCandidates = function (handler) {
  this.pendingCandidates.forEach(function(candidate) {
    candidateObj = {
      'type': 'ice',
      'sdp': {
        'candidate': candidate.candidate,
        'sdpMid': candidate.sdpMid,
        'sdpMLineIndex': candidate.sdpMLineIndex
      }
    };

    handler(candidateObj);
  });
};

WebRTCPeer.prototype.addIceCandidate = function (candidate) {
  var candidateObj = new this.RTCIceCandidate(candidate);
  this.pc.addIceCandidate(candidateObj);
};

(function() {

var host = window.location.host.split(':')[0];
var bridge = window.location.toString().split('?')[1] || host + ':9001';

var ws = null;
ws = new WebSocket("ws://" + bridge);

var peer = new WebRTCPeer(wrtc);

peer.addLocalIceCandidateHandler(function (candidate) {
  ws.send(JSON.stringify(candidate));
});
peer.addIceXferReadyCallback(function (cb) {
  return WebSocket.OPEN == ws.readyState;
});
peer.addDataChannelsReadyCallback(function (dataChannels) {
  var data = new Uint8Array([97, 99, 107, 0]);
  dataChannels['reliable'].send(data.buffer);
  dataChannels['reliable'].send("Hello bridge!");
});

ws.onopen = function() {
  peer.sendPendingIceCandidates(function (candidate) {
    ws.send(JSON.stringify(candidate));
  });

  peer.addSendOfferHandler(function (offer) {
    ws.send(JSON.stringify(offer));
  });

  peer.init();
};

ws.onmessage = function(event) {
  var data = JSON.parse(event.data);
  if('answer' == data.type) {
    peer._doSetRemoteDesc(data);
  } else if('ice' == data.type) {
    console.log(data);
    peer.addIceCandidate(data.sdp.candidate);
  }
};

})();
