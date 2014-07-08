$(document).ready(function() {
  var pc;
  var dc;

  $('button#offerbtn').click(function () {
    pc = new RTCPeerConnection(null);
    dc = pc.createDataChannel('zapchan');
    pc.createOffer(
      function (desc) {
        pc.setLocalDescription(
          desc,
          function () {
            console.log(desc);
            $('#offertxt').append(JSON.stringify(desc));
          },
          function (e) { console.log(e); }
        );
      },
      function (e) { console.log(e); }
    );
  });

  $('button#answerbtn').click(function () {
    var offertxt = $('#offertxt').val();
    var desc;
    try {
      desc = JSON.parse(offertxt);
    } catch(e) {
      console.log(e);
      return;
    }
    pc = new RTCPeerConnection(null);
    pc.ondatachannel = function (event) {
      dc = event.channel;
      dc.onmessage = function (event) {
        console.log("Data: ", event.data);
      };
    };

    pc.setRemoteDescription(
      new RTCSessionDescription(desc),
      function () {
        pc.createAnswer(
          function (answer) {
            pc.setLocalDescription(
              new RTCSessionDescription(answer),
              function () {
                console.log(answer);
                var anstxt = JSON.stringify(answer);
                $('#answertxt').append(anstxt);
              }
            );
          },
          function (e) { console.log(e); }
        );
      },
      function (e) { console.log(e); }
    );
  });

  $('#recvansbtn').click(function () {
    var anstxt = $('#answertxt').val();
    console.log(anstxt);
    try {
      desc = JSON.parse(anstxt);
    } catch(e) {
      console.log(e);
      return;
    }

    dc.onmessage = function (event) {
      console.log("Data: ", event.data);
    };

    dc.onopen = function (event) {
      console.log("Data channel open");
      dc.send("Hellooo");
    };

    pc.setRemoteDescription(
      new RTCSessionDescription(desc),
      function () {
        console.log("Session established");
      },
      function (e) { console.log(e); }
    );
  });
});
