function chanOpen(peer, channel) {
  console.log("Created AND OPENED channel", channel.label);
  $('#connection-establishment').remove();
  $('#msgs').append("<div id=\"input\"><input type=\"text\" id=\"msg\"></input><button id=\"send\">Send</button>");
  $('#msgs #send').click(function () {
    var msg = $('#msgs #msg').val();
    peer.send(channel.label, msg);
    $('#msgs #msg').val('');
    console.log("Sent on ", channel.label, ":", msg);
  });
}

$(document).ready(function () {
  var peer = new WebRTCPeer({
    sendOffer: function (peer, offer) {
      $('#recvoffer-p').remove();
      $('#createOffer').remove();
      $('#createoffer-p').append('Offer text.  Copy out of here.<br /><textarea id="createoffertxt"></textarea>');
      $('#createoffer-p #createoffertxt').val(JSON.stringify(offer));
      $('#createoffer-p').append('<br />Paste Answer text in here<br /><textarea id="recvanswertxt"></textarea><br /><button id="recvAnswer">Receive Answer</button>');
      $('#createoffer-p #recvAnswer').click(function () {
        var answer = JSON.parse($('#recvanswertxt').val());
        peer.recvAnswer(answer);
      });
    },
    sendAnswer: function (peer, answer) {
      $('#recvoffer-p').append('<br />Copy answer out of here.<br /><textarea id="sendanswertxt"></textarea>');
      $('#recvoffer-p #sendanswertxt').val(JSON.stringify(answer));
    },
    sendLocalIce: function (peer, candidate) {
      $('#localice').val($('#localice').val() + JSON.stringify(candidate) + "\n");
    },
    iceXferReady: function (peer) {
      return true;
    },
  });

  $('#createOffer').click(function () {
    peer.createOffer({
      zapchan: {
        outOfOrderAllowed: false,
        maxRetransmitNum: 10,

        onOpen: chanOpen,
        onMessage: function (peer, channel, msg) {
          console.log("Msg on ", channel.label, ": ", msg);
        },
      },
    });
  });

  $('#recvOffer').click(function () {
    peer.addExpectedDataChannels({
      'zapchan': {
        onOpen: chanOpen,
        onMessage: function (peer, channel, msg) {
          console.log("Msg on ", channel.label, ": ", msg);
        },
      },
    });
    peer.recvOffer(JSON.parse($('#recvoffertxt').val()));
  });

  $('#recvIce').click(function () {
    var candidatesTxt = $('#remoteice').val();
    var candidates = candidatesTxt.split(/\n/);
    candidates.forEach(function (candidate) {
      if (! /^$/.test(candidate)) {
        console.log(JSON.parse(candidate));
        peer.recvRemoteIceCandidate(JSON.parse(candidate));
      }
    });
  });
});
