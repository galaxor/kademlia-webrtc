$(document).ready(function() {

var host = window.location.host.split(':')[0];
var bridge = window.location.toString().split('?')[1] || host + ':9001';

var ws = null;
ws = new WebSocket("ws://" + bridge);

var peers = {};
var myId = null;

function chanOpen(peerId) {
  $('#buddies').append("<option value=\""+peerId+"\">"+peerId+"</option>");
}

function chanClose(peerId) {
  console.log("Channel with ",peerId,"closed.");
  $('#buddies option[value="'+peerId+'"]').remove();
}

$('#send').click(function () {
  var to = $('#buddies').val();
  var msg = $('#msg').val();
  if (typeof peers[to] != "undefined") {
    console.log("Sending to ",to,": ",msg);
    peers[to].send('zapchan', msg);
    $('#msg').val('');
  }
});

ws.onmessage = function (event) {
  var data = JSON.parse(event.data);
  console.log("WS Recvd", data);
  if (data.type == 'createOffer') {
    myId = data.id;
    var offers = {
      type: 'offers',
      from: myId,
      offers: [],
    };
    var nPeersAwaitingOffer = data.peers.length;
    data.peers.forEach(function (peerId) {
      peers[peerId] = new WebRTCPeer({
        sendOffer: function (peer, offer) {
          var offerMsg = {
            to: peerId,
            offer: offer,
          };
          offers.offers.push(offerMsg);
          nPeersAwaitingOffer--;
          console.log("nPeers", nPeersAwaitingOffer);
          if (nPeersAwaitingOffer == 0) {
            ws.send(JSON.stringify(offers));
          }
        },
        iceXferReady: function (peer) { return true; },
        sendLocalIce: function (peer, iceCandidate) {
          var localIceMsg = {
            type: 'ice',
            from: myId,
            to: peerId,
            candidate: iceCandidate,
          };
          ws.send(JSON.stringify(localIceMsg));
        },
        createDataChannels: {
          zapchan: {
            outOfOrderAllowed: false,
            maxRetransmitNum: 10,
            onOpen: function (peer, channel) {
              console.log("I opened channel with", peerId);
              chanOpen(peerId);
            },
            onMessage: function (peer, channel, msg) {
              console.log("Msg from", peerId, ":", msg);
            },
            onClose: function (peer, channel) {
              chanClose(peerId);
            },
          },
        },
      });
      peers[peerId].createOffer();
    });
  } else if (data.type == 'offer') {
    var peerId = data.from;
    peers[peerId] = new WebRTCPeer({
      sendAnswer: function (peer, answer) {
        var answerMsg = {
          type: 'answer',
          from: myId,
          to: peerId,
          answer: answer,
        };
        ws.send(JSON.stringify(answerMsg));
      },
      iceXferReady: function (peer) { return true; },
      sendLocalIce: function (peer, iceCandidate) {
        var localIceMsg = {
          type: 'ice',
          from: myId,
          to: peerId,
          candidate: iceCandidate,
        };
        ws.send(JSON.stringify(localIceMsg));
      },
      expectedDataChannels: {
        zapchan: {
          onOpen: function (peer, channel) {
            console.log("Channel opened by", peerId);
            chanOpen(peerId);
          },
          onMessage: function (peer, channel, msg) {
            console.log("Msg from ", peerId, ":", msg);
          },
          onClose: function (peer, channel) {
            chanClose(peerId);
          },
        },
      },
    });
    peers[peerId].recvOffer(data.offer);
  } else if (data.type == 'answer') {
    var peerId = data.from;
    peers[peerId].recvAnswer(data.answer);
  } else if (data.type == 'ice') {
    var peerId = data.from;
    peers[peerId].recvRemoteIceCandidate(data.candidate);
  }
};

});
