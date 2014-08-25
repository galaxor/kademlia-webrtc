function NodePeer() {
  var wrtc = require('wrtc')
  var WebRTCPeer = require('./WebRTCPeer')

  this.peer = new WebRTCPeer(wrtc);
  var me = this;
  this.peer.addDataChannelOpenHandler(function (dc) { me.dataChannelOpen(dc); });
  this.dc = null;

  this.peer.addMsgHandler(function (event) {
    console.log(event.data);
  });
}

NodePeer.prototype.createOffer = function () {
  this.peer.createOffer(function (offer) {
    console.log(JSON.stringify(offer));
  });
}

NodePeer.prototype.createAnswer = function (offertxt) {
  this.peer.createAnswer(offertxt, function (answer) {
    var anstxt = JSON.stringify(answer);
    console.log(anstxt);
  });
}

NodePeer.prototype.recvAnswer = function (anstxt) {
  this.peer.recvAnswer(anstxt);
}

NodePeer.prototype.dataChannelOpen = function (dc) {
  this.dc = dc;
  console.log("Data channel open");
}

NodePeer.prototype.send = function (msg) {
  console.log("Msg is ", msg);
  dc.send(msg);
}

module.exports = exports = NodePeer;
