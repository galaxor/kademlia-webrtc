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
      onOpen: function (channel) {
        var data = new Uint8Array([97, 99, 107, 0]);
        channel.send(data.buffer);
        channel.send("Hello bridge!");
      },
      onMessage: function (channel, data) {
        if('string' == typeof data) {
          console.log('onmessage:',channel.label, data);
        } else {
          console.log('onmessage:',channel.label, new Uint8Array(data));
        }
      },
    },
  },
});

peer.addSendLocalIceCandidateHandler(function (candidate) {
  ws.send(JSON.stringify(candidate));
});
peer.addIceXferReadyCallback(function (cb) {
  return WebSocket.OPEN == ws.readyState;
});

ws.onopen = function() {
  peer.addSendOfferHandler(function (offer) {
    ws.send(JSON.stringify(offer));
  });

  peer.createOffer();
};

ws.onmessage = function(event) {
  var data = JSON.parse(event.data);
  if('answer' == data.type) {
    peer.recvAnswer(data);
  } else if('ice' == data.type) {
    console.log(data);
    peer.recvRemoteIceCandidate(data);
  }
};

})();
