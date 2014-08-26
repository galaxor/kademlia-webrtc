$(document).ready(function() {
  var peer = new WebRTCPeer();
  peer.addDataChannelOpenHandler(dataChannelOpen);

  // The websocket client for session establishment
  var socket = io('http://localhost:5333');

  socket.on('connect', function () {
    console.log("Connected");
  });

  socket.on('createanswer', function (offer) {
    peer.createAnswer(offer, function (answer) {
      console.log("Created answer",answer);
      socket.emit('answer', answer);
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
