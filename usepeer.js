$(document).ready(function() {
  var peer = new WebRTCPeer();
  peer.addDataChannelOpenHandler(dataChannelOpen);

  peer.addMsgHandler(function (event) {
    $('#msgroll').prepend('<div class="them">'+event.data+'</div>');
  });

  // The websocket client for session establishment
  var socket = io('http://localhost:5333');

  socket.on('connect', function () {
    // The newly-connecting client will create an offer and send it.  The
    // meet-n-greet server will store the offers.  When it has two willing
    // clients, it will send one of the stored offers to the newcomer.
    peer.createOffer(function (offer) {
      console.log("Created offer",offer);
      socket.emit('offer', offer);
    });

    socket.on('recvanswer', function (answer) {
      console.log("Received answer",answer);
      peer.recvAnswer(answer);

      // Since we received an answer, the offer we had on file with the server
      // is consumed.  Make a replacement.
      peer.createOffer(function (offer) {
        console.log("Created replacement offer",offer);
        socket.emit('offer', offer);
      });
    });

    socket.on('createanswer', function (offer) {
      peer.createAnswer(offer, function (answer) {
        console.log("Created answer",answer);
        socket.emit('answer', answer);
      });
    });
  });
});

function dataChannelOpen(dc) {
  console.log("Data channel open");
  $('#session_establishment').hide();

  $('#sendmsg').click(function () {
    var msg = $('#msgtxt').val();
    console.log("Msg is ", msg);
    $('#msgroll').prepend('<div class="you">'+msg+'</div>');
    dc.send(msg);
  });
}
