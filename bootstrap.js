var wrtc = require('wrtc');
var WebRTCPeer = require('./WebRTCPeer');

var app = require('express')();
var cors = require('cors');
app.use(cors());

var server = require('http').Server(app);
var io = require('socket.io')(server);

io.on('connection', function (socket){ 
  var peer = new WebRTCPeer(wrtc);

  peer.createOffer(function (offer) {
    console.log("Created offer",offer);
    socket.emit('createanswer', offer);
  });

  socket.on('answer', function (answer) {
    peer.recvAnswer(answer);
  });

  peer.addDataChannelOpenHandler(dataChannelOpen);

  peer.addMsgHandler(msgHandler);
});
server.listen(5333);

function dataChannelOpen(dc) {
  console.log("Data channel open");

  // Now we can use
  // dc.send(msg);
}

function msgHandler(event) {
  console.log("They said ",event.data);
}
