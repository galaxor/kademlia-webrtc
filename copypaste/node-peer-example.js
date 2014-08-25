var wrtc = require('wrtc');
var WebRTCPeer = require('./WebRTCPeer')
;
var peer = new WebRTCPeer(wrtc);
peer.createAnswer(JSON.parse('{"type":"offer","sdp":"v=0\r\no=Mozilla-SIPUA-31.0 10341 0 IN IP4 0.0.0.0\r\ns=SIP Call\r\nt=0 0\r\na=ice-ufrag:ee7f96ea\r\na=ice-pwd:85a06507d6cd374a2b44ce07e437954f\r\na=fingerprint:sha-256 4F:74:EC:DD:F1:CC:34:56:12:2E:10:20:90:2D:55:F9:94:F1:39:9C:E1:E2:FB:8D:DF:35:2E:21:14:3D:E8:C6\r\nm=application 42494 DTLS/SCTP 5000\r\nc=IN IP4 141.214.200.58\r\na=sctpmap:5000 webrtc-datachannel 16\r\na=setup:actpass\r\na=candidate:0 1 UDP 2122252543 141.214.200.58 32933 typ host\r\na=candidate:2 1 UDP 2122187007 10.0.3.1 42494 typ host\r\na=candidate:3 1 UDP 1686044671 141.214.200.58 42494 typ srflx raddr 10.0.3.1 rport 42494\r\n"}'.replace(/\r/g, '\\r').replace(/\n/g, '\\n')), function (ans) { console.log(JSON.stringify(ans)); });

function dataChannelOpen(dc) {
  console.log("Data channel open");

  peer.send = function (msg) {
    dc.send(msg);
  };
}

peer.addMsgHandler(function (event) {
  console.log("They said ",event.data);
});

peer.addDataChannelOpenHandler(dataChannelOpen);
