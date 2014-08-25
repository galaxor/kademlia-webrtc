function WebRTCPeer(namespace) {
  this.pc = null;
  this.dc = null;
  this.msgHandlers = [];
  this.dataChannelOpenHandlers = [];

  if (typeof namespace == "undefined") {
    this.RTCPeerConnection = RTCPeerConnection;
    this.RTCSessionDescription = RTCSessionDescription;
  } else {
    this.RTCPeerConnection = namespace.RTCPeerConnection;
    this.RTCSessionDescription = namespace.RTCSessionDescription;
  }
}

WebRTCPeer.prototype.createOffer = function (callback) {
  var peer = this;

  this.pc = new this.RTCPeerConnection(null);
  this.dc = this.pc.createDataChannel('zapchan');
  this.dc.onopen = function () { peer.dataChannelOpen(this) };
  this.pc.createOffer(
    function (offer) {
      peer.pc.setLocalDescription(
        offer,
        function () {
          callback(offer);
        },
        function (e) { console.log(e); }
      );
    },
    function (e) { console.log(e); }
  );
};

WebRTCPeer.prototype.createAnswer = function (desc, callback) {
  var peer = this;

  this.pc = new this.RTCPeerConnection(null);
  this.pc.ondatachannel = function (event) {
    peer.dc = event.channel;

    peer.dc.onopen = function () { peer.dataChannelOpen(this); };
  };

  this.pc.setRemoteDescription(
    new this.RTCSessionDescription(desc),
    function () {
      peer.pc.createAnswer(
        function (answer) {
          peer.pc.setLocalDescription(
            new this.RTCSessionDescription(answer),
            function () {
              callback(answer);
            }
          );
        },
        function (e) { console.log(e); }
      );
    },
    function (e) { console.log(e); }
  );
};

WebRTCPeer.prototype.recvAnswer = function (desc) {
  var peer = this;

  // The dataChannel's onopen handler was already set by createOffer or createAnswer.

  this.pc.setRemoteDescription(
    new this.RTCSessionDescription(desc),
    function () {},
    function (e) { console.log(e); }
  );
};

WebRTCPeer.prototype.addDataChannelOpenHandler = function (handler) {
  this.dataChannelOpenHandlers[this.dataChannelOpenHandlers.length] = handler;
};

WebRTCPeer.prototype.dataChannelOpen = function (dc) {
  var peer = this;
  dc.onmessage = function (event) { peer.onMessage(event); };

  for (var i=0; i<this.dataChannelOpenHandlers.length; i++) {
    this.dataChannelOpenHandlers[i](dc);
  }
};

WebRTCPeer.prototype.addMsgHandler = function (handler) {
  this.msgHandlers[this.msgHandlers.length] = handler;
};

WebRTCPeer.prototype.onMessage = function (event) {
  for (var i=0; i<this.msgHandlers.length; i++) {
    this.msgHandlers[i](event);
  }
};

module.exports = exports = WebRTCPeer;
