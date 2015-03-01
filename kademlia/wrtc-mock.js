var wrtc = {};

var timers = require('timers');
var setTimeout = timers.setTimeout;
var clearTimeout = timers.clearTimeout;

/**
 * RTCPeerConnection.
 */
wrtc.RTCPeerConnection = function (configuration, constraints) {
  this.localEnd = null;
  this.remoteEnd = null;
  this.genLocalIce = false;
  this.recvRemoteIce = false;

  this.dataChannels = {};
};

wrtc.RTCPeerConnection.prototype.setLocalDescription = function (sessionDescription, successCallback, errorCallback) {
  this.localEnd = sessionDescription.endpoint;
};

wrtc.RTCPeerConnection.prototype.setRemoteDescription = function (sessionDescription, successCallback, errorCallback) {
  this.remoteEnd = sessionDescription.endpoint;

  for (var label in remoteEnd.dataChannels) {
    if (typeof this.dataChannels[label] == "undefined") {
      this.dataChannels[label] = new wrtc.RTCDataChannel(label);
    }
  }

  setTimeout(function () {
    successCallback();

    this.generateIceCandidate();
  }, 0);
};

wrtc.RTCPeerConnection.prototype.onicecandidate = function (event) { };

wrtc.RTCPeerConnection.prototype.createOffer = function (successCallback, failureCallback, constraints) {
  var peer = this;
  setTimeout(function () {
    successCallback(peer);
  }, 0);
};

wrtc.RTCPeerConnection.prototype.createAnswer = function (successCallback, failureCallback, constraints) {
  successCallback(this);

  setTimeout(function () {
    this.generateIceCandidate();
  }, 0);
};

wrtc.RTCPeerConnection.prototype.addIceCandidate = function (candidate) {
  if (!this.recvRemoteIce) {
    this.recvRemoteIce = true;
    // Open data channels.
    for (label in this.dataChannels) {
      this.dataChannels[label].open();
    }
  }
};

wrtc.RTCPeerConnection.prototype.createDataChannel = function (label, channelOptions) {
  this.dataChannels[label] = new wrtc.RTCDataChannel(label, this);
  return this.dataChannels[label];
};

wrtc.RTCPeerConnection.prototype.generateIceCandidate = function () {
  this.genLocalIce = true;

  var event = {
    target: 'fake',
    candidate: 'candidate',
  };
  if (typeof this.onicecandidate == "function") {
    this.onicecandidate(event);
  }
};

/**
 * RTCSessionDescription.
 */
wrtc.RTCSessionDescription = function (data) {
  this.endpoint = data;
};

/**
 * RTCIceCandidate.
 */
wrtc.RTCIceCandidate = function (candidate) {
  this.candidate = candidate;
};

/**
 * RTCDataChannel.
 */
wrtc.RTCDataChannel = function (label, peer) {
  this.label = label;
  this.peer = peer;
  this.open = false;
};

wrtc.RTCDataChannel.prototype.send = function (msg) {
  if (this.open) {
    this.peer.remoteEnd.dataChannels[this.label].recv(msg);
  } else {
    throw new Error('data channel not open');
  }
};

/**
 * This is not part of the WebRTC spec.  I invented this for the mock.
 */
wrtc.RTCDataChannel.prototype.recv = function (msg) {
  if (this.open) {
    if (typeof this.onmessage = "function") {
      var event = {
        data: msg,
      };
      this.onmessage(event);
    }
  } else {
    throw new Error('data channel not open');
  }
};

/**
 * This is not part of the WebRTC spec.  I invented this for the mock.
 */
wrtc.RTCDataChannel.prototype.open = function () {
  this.open = true;
  if (typeof this.onopen == "function") {
    this.onopen();
  }
};

module.exports = exports = wrtc;
