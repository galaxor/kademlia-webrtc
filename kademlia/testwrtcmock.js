var wrtc = require('./wrtc-mock');
var mock = require('mock');

var WebRTCPeer = mock("WebRTCPeer", {
    wrtc: wrtc,
  },
  require
);

var alice = new WebRTCPeer({
  sendOffer: function (peer, offer) {
    bob.recvOffer(offer);
  },
  sendLocalIce: function (peer, iceCandidate) {
    bob.recvRemoteIceCandidate(iceCandidate);
  },
  createDataChannels: {
    zapchan: {
      onOpen: function () { console.log("alice's zapchan open"); },
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
});

alice.createOffer();

setTimeout(function () {
  alice.send('zapchan', 'hello');
}, 1);
