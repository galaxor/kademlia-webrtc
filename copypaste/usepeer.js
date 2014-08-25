$(document).ready(function() {
  var peer = new WebRTCPeer();
  peer.addDataChannelOpenHandler(dataChannelOpen);

  peer.addMsgHandler(function (event) {
    $('#msgroll').prepend('<div class="them">'+event.data+'</div>');
  });

  $('button#offerbtn').click(function () {
    peer.createOffer(function (offer) {
      $('#offertxt').append(JSON.stringify(offer));
    });
  });

  $('button#answerbtn').click(function () {
    var offertxt = $('#offertxt').val();
    var offer = JSON.parse(offertxt);

    peer.createAnswer(offer, function (answer) {
      var anstxt = JSON.stringify(answer);
      $('#answertxt').append(anstxt);
    });
  });

  $('#recvansbtn').click(function () {
    var anstxt = $('#answertxt').val();
    var answer = JSON.parse(anstxt);
    peer.recvAnswer(answer);
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
