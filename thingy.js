$(document).ready(function() {
  var pc;
  var dc;

  $('button#offerbtn').click(function () {
    var retval = createOffer();
    pc = retval.peerConnection;
    dc = retval.dataChannel;
  });

  $('button#answerbtn').click(function () {
    var offertxt = $('#offertxt').val();
    createAnswer(offertxt);
  });

  $('#recvansbtn').click(function () {
    var anstxt = $('#answertxt').val();
    recvAnswer(anstxt, pc);
  });
});

function createOffer() {
  var pc = new RTCPeerConnection(null);
  var dc = pc.createDataChannel('zapchan');
  dc.onopen = dataChannelOpen;
  var offertxt;
  pc.createOffer(
    function (offer) {
      pc.setLocalDescription(
        offer,
        function () {
          console.log(offer);
          publishOffer(offer);
        },
        function (e) { console.log(e); }
      );
    },
    function (e) { console.log(e); }
  );

  return {
    peerConnection: pc,
    dataChannel: dc,
  };
}

function createAnswer(offertxt) {
  var desc;
  try {
    desc = JSON.parse(offertxt);
  } catch(e) {
    console.log(e);
    return;
  }
  var pc = new RTCPeerConnection(null);
  pc.ondatachannel = function (event) {
    dc = event.channel;

    dc.onopen = dataChannelOpen;
  };

  pc.setRemoteDescription(
    new RTCSessionDescription(desc),
    function () {
      pc.createAnswer(
        function (answer) {
          pc.setLocalDescription(
            new RTCSessionDescription(answer),
            function () {
              publishAnswer(answer);
            }
          );
        },
        function (e) { console.log(e); }
      );
    },
    function (e) { console.log(e); }
  );
}

function recvAnswer(anstxt, pc) {
  console.log(anstxt);
  var desc;
  try {
    desc = JSON.parse(anstxt);
  } catch(e) {
    console.log(e);
    return;
  }

  // The dataChannel's onopen handler was already set by createOffer.

  pc.setRemoteDescription(
    new RTCSessionDescription(desc),
    function () {
      console.log("Session established");
    },
    function (e) { console.log(e); }
  );
}

function publishOffer(offer) {
  $('#offertxt').append(JSON.stringify(offer));
}

function publishAnswer(answer) {
  console.log(answer);
  var anstxt = JSON.stringify(answer);
  $('#answertxt').append(anstxt);
}

function dataChannelOpen() {
  var dc = this;
  console.log("Data channel open");
  $('#session_establishment').hide();

  dc.onmessage = onMessage;

  $('#sendmsg').click(function () {
    var msg = $('#msgtxt').val();
    console.log("Msg is ", msg);
    $('#msgroll').prepend('<div class="you">'+msg+'</div>');
    dc.send(msg);
  });
}

function onMessage(event) {
  $('#msgroll').prepend('<div class="them">'+event.data+'</div>');
}
