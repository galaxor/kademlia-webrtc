function WebRTCPeer (namespace) {
  this.pendingDataChannels = {};
  this.dataChannels = {}
  this.pendingCandidates = [];
  this.pc = null;
  this.offer = null;
  this.answer = null;
  this.remoteReceived = false;

  this.answerCreatedHandlers = [];
  this.localIceCandidateHandlers = [];
  this.dataChannelHandlers = [];

  if (typeof namespace == "undefined") {
    this.RTCPeerConnection = RTCPeerConnection;
    this.RTCSessionDescription = RTCSessionDescription;
    this.RTCIceCandidate = RTCIceCandidate;
  } else {
    this.RTCPeerConnection = namespace.RTCPeerConnection;
    this.RTCSessionDescription = namespace.RTCSessionDescription;
    this.RTCIceCandidate = namespace.RTCIceCandidate;
  }

  this.dataChannelSettings = {
    'reliable': {
      ordered: false,
      maxRetransmits: 0
    },
  };
}

WebRTCPeer.prototype.recvOffer = function (data) {
  this.offer = new this.RTCSessionDescription(data);
  this.answer = null;
  this.remoteReceived = false;

  this.pc = new this.RTCPeerConnection(
    {
      iceServers: [{url:'stun:stun.l.google.com:19302'}]
    },
    {
      'optional': [{DtlsSrtpKeyAgreement: false}]
    }
  );

  this.pc.onsignalingstatechange = function(state) {
    console.info('signaling state change:', state);
  };
  this.pc.oniceconnectionstatechange = function(state) {
    console.info('ice connection state change:', state);
  };
  this.pc.onicegatheringstatechange = function(state) {
    console.info('ice gathering state change:', state);
  };

  var peer = this;
  this.pc.onicecandidate = function(candidate) {
    peer.xferIceCandidate(candidate);
  }

  this.doHandleDataChannels();
};

WebRTCPeer.prototype.recvRemoteIceCandidate = function (data) {
  if (this.remoteReceived) {
    this.pc.addIceCandidate(new this.RTCIceCandidate(data.sdp.candidate));
  } else {
    this.pendingCandidates.push(data);
  }
};

WebRTCPeer.prototype.addLocalIceCandidateHandler = function (handler) {
  this.localIceCandidateHandlers.push(handler);
};

WebRTCPeer.prototype.xferIceCandidate = function (candidate) {
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

WebRTCPeer.prototype.doComplete = function () {
  console.info('complete');
};

WebRTCPeer.prototype.doHandleError = function (error) {
  throw error;
}

WebRTCPeer.prototype.doCreateAnswer = function () {
  this.remoteReceived = true;
  var peer = this;
  this.pendingCandidates.forEach(function(candidate) {
    peer.pc.addIceCandidate(new peer.RTCIceCandidate(candidate.sdp));
  });
  this.pc.createAnswer(
    function (desc) { peer.doSetLocalDesc(desc); },
    function (error) { peer.doHandleError(error); }
  );
};

WebRTCPeer.prototype.doSetLocalDesc = function (desc) {
  this.answer = desc;
  console.info("DESC:: ", desc);
  var peer = this;
  this.pc.setLocalDescription(
    desc,
    function () { peer.doSendAnswer(); },
    function (error) { peer.doHandleError(error); }
  );
};

WebRTCPeer.prototype.addDataChannelOpenHandler = function (handler) {
  this.dataChannelopenHandlers.push(handler);
};

WebRTCPeer.prototype.doHandleDataChannels = function () {
  var labels = Object.keys(this.dataChannelSettings);

  console.log("Handling data channels");

  var peer = this;
  console.log("SET PEER == ", peer);

  this.pc.ondatachannel = function(evt) {
    var channel = evt.channel;

    console.log("Recognize me, peer? ", peer);

    console.log('ondatachannel', channel.label, channel.readyState);
    var label = channel.label;
    peer.pendingDataChannels[label] = channel;
    channel.binaryType = 'arraybuffer';
    channel.onopen = function() {
      console.info('onopen');
      peer.dataChannels[label] = channel;
      delete peer.pendingDataChannels[label];
      if(Object.keys(peer.dataChannels).length === labels.length) {
        peer.doComplete();
      }

      peer.dataChannelHandlers.forEach(function (handler) {
        handler(channel);
      });
    };

    channel.onmessage = function(evt) {
      var data = evt.data;
      console.log('onmessage:', evt.data);
      if('string' == typeof data) {
        channel.send("Hello peer!");
      } else {
        var response = new Uint8Array([107, 99, 97, 0]);
        channel.send(response.buffer);
      }
    };

    channel.onclose = function() {
      console.info('onclose');
    };

    channel.onerror = function (error) { peer.doHandleError(error); };
  };

  this.doSetRemoteDesc();
};

WebRTCPeer.prototype.doSetRemoteDesc = function () {
  console.info(this.offer);
  var peer = this;
  this.pc.setRemoteDescription(
    this.offer,
    function () { peer.doCreateAnswer(); },
    function (error) { peer.doHandleError(error); }
  );
};

WebRTCPeer.prototype.addAnswerCreatedHandler = function (handler) {
  this.answerCreatedHandlers.push(handler);
};

WebRTCPeer.prototype.doSendAnswer = function () {
  console.log("Sending answer:", this.answer);
  var peer = this;
  this.answerCreatedHandlers.forEach(function(handler) {
    handler(peer.answer);
  });
  console.log("Awaiting data channels");
};


var static = require('node-static-alias');
var http = require('http');
var webrtc = require('wrtc');
var ws = require('ws');

var args = require('minimist')(process.argv.slice(2));
var host = args.h || '127.0.0.1';
var port = args.p || 8080;
var socketPort = args.ws || 9001;

var file = new static.Server('./node_modules/wrtc/examples', {
    alias: {
        match: '/dist/wrtc.js',
        serve: '../dist/wrtc.js',
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
wss.on('connection', function(ws)
{
  console.info('ws connected');

  var peer = new WebRTCPeer(webrtc);

  peer.addLocalIceCandidateHandler(function (iceCandidate) {
    ws.send(JSON.stringify(iceCandidate));
  });

  peer.addAnswerCreatedHandler(function (answer) {
    ws.send(JSON.stringify(answer));
  });

  ws.on('message', function(data)
  {
    data = JSON.parse(data);
    if('offer' == data.type)
    {
      peer.recvOffer(data);
    } else if('ice' == data.type)
    {
      peer.recvRemoteIceCandidate(data);
    }
  });
});
