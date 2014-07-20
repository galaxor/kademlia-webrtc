require('wrtc')

var peer = new WebRTCPeer();
peer.addDataChannelOpenHandler(dataChannelOpen);

peer.addMsgHandler(function (event) {
  console.log(event.data);
});

function createOffer() {
  peer.createOffer(function (offer) {
    console.log(JSON.stringify(offer));
  });
}

function createAnswer(offertxttxt) {
  peer.createAnswer(offertxt, function (answer) {
    var anstxt = JSON.stringify(answer);
    console.log(anstxt);
  });
}

function recvAnswer(anstxt) {
  peer.recvAnswer(anstxt);
}
