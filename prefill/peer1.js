var offers = [];

$(document).ready(function () {
  // Generate five offers.  Forget all but one.  Transmit that one.
  for (var i=0; i<5; i++) {
    var peer = new WebRTCPeer({
      sendOffer: function (peer, offer) {
        offers.push(offer);
        if (offers.length >= 5) {
          offersMade();
        }
      },
      createDataChannels: {
        zoobtube: {
          outOfOrderAllowed: false,
          maxRetransmitNum: 10,
          // I'm not actually registering any callbacks, because I intend to
          // throw these objects away and make new ones later.
        },
      },
    });
    peer.createOffer();
  }
});

function offersMade() {
  console.log("Offers made");

  // All of the offers have been made.  We've gone ahead and thrown away the
  // actual WebRTCPeer objects.  Let's transmit one of the offers.
  
  var host = window.location.host.split(':')[0];
  var bridge = window.location.toString().split('?')[1] || host + ':9001';

  var ws = null;
  ws = new WebSocket("ws://" + bridge);

  var peers = {};
  var myId = null;

  ws.onopen = function (event) {
    var offerMsg = {
      type: 'offer',
      from: 1,
      offer: offers[0],
    };
    console.log("Sending offer msg", offerMsg);
    ws.send(JSON.stringify(offerMsg));
  };

  console.log("WS", ws);

  var peer = null;

  ws.onmessage = function (event) {
    var data = JSON.parse(event.data);

    if (peer == null) {
      console.log("Creating the WebRTCPeer");
      peer = new WebRTCPeer({
        sendOffer: function (peer, offer) {
          if (data.type == 'answer') {
            console.log("My offer would have been", offer);
            console.log("Recvd Answer", data.answer);
            peer.recvAnswer(data.answer);
          } else if (data.type == 'ice') {
            peer.recvRemoteIceCandidate(data.iceCandidate);
          }
        },
        sendLocalIce: function (peer, iceCandidate) {
          var iceMsg = {
            type: 'ice',
            from: 1,
            iceCandidate: iceCandidate,
          };

          console.log("Sending ice msg", iceMsg);
          ws.send(JSON.stringify(iceMsg));
        },
        createDataChannels: {
          zoobtube: {
            outOfOrderAllowed: false,
            maxRetransmitNum: 10,
            onOpen: function (peer, channel) {
              console.log("Opened zoobtube!");
              channel.send("Hello stranger");
            },
            onMessage: function (peer, channel, msg) {
              console.log("Message on zoobtube:", msg);
            },
          },
        },
      });
      // Create the offer.  It will be thrown away while we wait for an answer
      // to our old offer.
      peer.createOffer();
    } else if (data.type == 'answer') {
      console.log("Recvd Answer", data.answer);
      peer.recvAnswer(data.answer);
    } else if (data.type == 'ice') {
      peer.recvRemoteIceCandidate(data.iceCandidate);
    }
  };
}
