(function() {

var host = window.location.host.split(':')[0];
var bridge = window.location.toString().split('?')[1] || host + ':9001';

var ws = null;
ws = new WebSocket("ws://" + bridge);

var peer = new WebRTCPeer({
  createDataChannels: {
    reliable: {
      outOfOrderAllowed: false,
      maxRetransmitNum: 10,
      onOpen: function (peer, channel) {
        var data = new Uint8Array([97, 99, 107, 0]);
        channel.send(data.buffer);
        channel.send("Hello bridge!");
      },
      onMessage: function (peer, channel, data) {
        if('string' == typeof data) {
          console.log('onmessage:',channel.label, data);
        } else {
          console.log('onmessage:',channel.label, new Uint8Array(data));
        }
      },
    },
  },

  sendLocalIce: function (peer, candidate) {
    console.log("Going to send ", candidate);
    ws.send(JSON.stringify(candidate));
  },

  iceXferReady: function (peer) {
    return WebSocket.OPEN == ws.readyState;
  },

  sendOffer: function (peer, offer) {
    ws.send(JSON.stringify(offer));
  },
});

ws.onopen = function() {
  peer.createOffer();
};

ws.onmessage = function(event) {
  var data = JSON.parse(event.data);
  if('answer' == data.type) {
    peer.recvAnswer(data);
  } else if('ice' == data.type) {
    console.log("Recvd remote candidate", data);
    peer.recvRemoteIceCandidate(data);
  }
};

})();
