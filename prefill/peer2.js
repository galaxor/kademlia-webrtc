var peer = null;

$(document).ready(function () {
  var host = window.location.host.split(':')[0];
  var bridge = window.location.toString().split('?')[1] || host + ':9001';

  var ws = null;
  ws = new WebSocket("ws://" + bridge);

  ws.onopen = function (event) {
    var msg = {
      type: 'getOffer',
      from: 2,
    };
    console.log("Asking for offers", msg);
    ws.send(JSON.stringify(msg));

    ws.onmessage = function (event) {
      var data = JSON.parse(event.data);
      if (data.type == 'offer') {
        peer = new WebRTCPeer({
          sendAnswer: function (peer, answer) {
            var answerMsg = {
              from: 2,
              type: 'answer',
              answer: answer,
            };
            console.log("Sending answer ", answerMsg);
            ws.send(JSON.stringify(answerMsg));
          },
          sendLocalIce: function (peer, iceCandidate) {
            var iceMsg = {
              type: 'ice',
              from: 2,
              iceCandidate: iceCandidate,
            };

            console.log("Sending ice msg", iceMsg);
            ws.send(JSON.stringify(iceMsg));
          },
          expectedDataChannels: {
            zoobtube: {
              onOpen: function (peer, channel) {
                console.log("Opened zoobtube!");
                channel.send("Hello friend");
              },
              onMessage: function (peer, channel, msg) {
                console.log("Message on zoobtube:", msg);
              },
            },
          },
        });
        peer.recvOffer(data.offer);
      } else if (data.type == 'ice') {
        peer.recvRemoteIceCandidate(data.iceCandidate);
      }
    };
  };
});
