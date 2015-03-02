var wrtc = require('./wrtc-mock');
var mock = require('mock');

var WebRTCPeer = mock("WebRTCPeer", {
    wrtc: wrtc,
  },
  require
);

var alice = new WebRTCPeer({
  name: 'alice',
  sendOffer: function (peer, offer) {
    bob.recvOffer(offer);
  },
  sendLocalIce: function (peer, iceCandidate) {
    bob.recvRemoteIceCandidate(iceCandidate);
  },
  createDataChannels: {
    zapchan: {
      onOpen: function (peer, channel) {
        console.log("alice's zapchan open"); 
        setTimeout(function () {
          console.log("alice cent hello");
          peer.send('zapchan', 'hello');
        }, 1);
      },
      onMessage: function (peer, channel, msg) { console.log('alice recved:', msg); },
    },
  },
});

var bob = new WebRTCPeer({
  sendAnswer: function (peer, answer) {
    alice.recvAnswer(answer);
  },
  sendLocalIce: function (peer, iceCandidate) {
    alice.recvRemoteIceCandidate(iceCandidate);
  },
  expectedDataChannels: {
    zapchan: {
      onOpen: function (peer, channel) {
        console.log("bob's zapchan open");
      },
      onMessage: function (peer, channel, msg) { console.log('bob recved:', msg); },
    },
  },
});

alice.createOffer();
