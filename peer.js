function WebRTCPeer(bridge) {
  // We expect you to have included ../dist/wrtc.js via a <script> tag before
  // including this one.  That will give us the definition of wrtc.

  this.RTCPeerConnection     = wrtc.RTCPeerConnection;
  this.RTCSessionDescription = wrtc.RTCSessionDescription;
  this.RTCIceCandidate       = wrtc.RTCIceCandidate;

  this.dataChannelSettings = {
    'reliable': {
          outOfOrderAllowed: false,
          maxRetransmitNum: 10
        },
  };

  this.pendingDataChannels = {};
  this.dataChannels = {};
  this.pendingCandidates = [];
  this.ws = null;
  this.pc = null;
  this.bridge = bridge;
}

WebRTCPeer.prototype.doHandleError = function (error) {
  throw error;
};

WebRTCPeer.prototype.doComplete = function () {
  console.log('complete');
  var data = new Uint8Array([97, 99, 107, 0]);
  this.dataChannels['reliable'].send(data.buffer);
  this.dataChannels['reliable'].send("Hello bridge!");
};

WebRTCPeer.prototype.doWaitforDataChannels = function () {
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
    console.info("signaling state change: ", event.target.signalingState);
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
    if(WebSocket.OPEN == peer.ws.readyState) {
      peer.ws.send(JSON.stringify(
        {'type': 'ice',
         'sdp': {'candidate': candidate.candidate, 'sdpMid': candidate.sdpMid, 'sdpMLineIndex': candidate.sdpMLineIndex}
        })
      );
    } else {
      peer.pendingCandidates.push(candidate);
    }
  };

  this.doCreateDataChannels();
};

WebRTCPeer.prototype.doCreateDataChannels = function () {
  var peer = this;
  var labels = Object.keys(this.dataChannelSettings);
  labels.forEach(function(label) {
    var channelOptions = peer.dataChannelSettings[label];
    var channel = peer.pendingDataChannels[label] = peer.pc.createDataChannel(label, channelOptions);
    channel.binaryType = 'arraybuffer';
    channel.onopen = function() {
      console.info('onopen');
      peer.dataChannels[label] = channel;
      delete peer.pendingDataChannels[label];
      if(Object.keys(peer.dataChannels).length === labels.length) {
        peer.doComplete();
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
    channel.onerror = function (error) { peer.doHandleError(error); };
  });
  this.doCreateOffer();
};

WebRTCPeer.prototype.doCreateOffer = function () {
  var peer = this;
  this.pc.createOffer(
    function (desc) { peer.doSetLocalDesc(desc); },
    function (error) { peer.doHandleError(error); }
  );
}

WebRTCPeer.prototype.doSetLocalDesc = function (desc) {
  var peer = this;
  this.pc.setLocalDescription(
    new this.RTCSessionDescription(desc),
    this.doSendOffer.bind(peer, desc),
    function (error) { peer.doHandleError(error); }
  );
}

WebRTCPeer.prototype.doSendOffer = function (offer) {
  var peer = this;
  this.ws = new WebSocket("ws://" + this.bridge);
  this.ws.onopen = function() {
    peer.pendingCandidates.forEach(function(candidate) {
      peer.ws.send(JSON.stringify(
        {'type': 'ice',
         'sdp': {'candidate': candidate.candidate, 'sdpMid': candidate.sdpMid, 'sdpMLineIndex': candidate.sdpMLineIndex}
        })
      );
    });
    peer.ws.send(JSON.stringify(
      {'type': offer.type, 'sdp': offer.sdp})
    );
  };
  this.ws.onmessage = function(event) {
    var data = JSON.parse(event.data);
    if('answer' == data.type)
    {
      peer.doSetRemoteDesc(data);
    } else if('ice' == data.type) {
      console.log(data);
      var candidate = new peer.RTCIceCandidate(data.sdp.candidate);
      peer.pc.addIceCandidate(candidate);
    }
  };
};

WebRTCPeer.prototype.doSetRemoteDesc = function (desc) {
  var peer = this;
  this.pc.setRemoteDescription(
    new peer.RTCSessionDescription(desc),
    function () { peer.doWaitforDataChannels(); },
    function (error) { peer.doHandleError(error); }
  );
};

(function() {

var host = window.location.host.split(':')[0];
var bridge = window.location.toString().split('?')[1] || host + ':9001';

var peer = new WebRTCPeer(bridge);
peer.init();

})();
