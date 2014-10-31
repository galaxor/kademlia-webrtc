var WebRTCPeer = require('./WebRTCPeer');

var static = require('node-static-alias');
var http = require('http');
var ws = require('ws');

var args = require('minimist')(process.argv.slice(2));
var host = args.h || '127.0.0.1';
var port = args.p || 8080;
var socketPort = args.ws || 9001;

var file = new static.Server('./', {
    alias: {
        match: '/dist/wrtc.js',
        serve: 'node_modules/wrtc/dist/wrtc.js',
        allowOutside: true
      }
    });

var app = http.createServer(function (req, res) {
    console.log(req.url);
    req.addListener('end', function() {
        file.serve(req, res);
      }).resume();

}).listen(port, host);
console.log('Server running at http://' + host + ':' + port + '/');

var wss = new ws.Server({'port': socketPort});
wss.on('connection', function(ws) {
  console.info('~~~~~ ws connected ~~~~~~');

  var peer = new WebRTCPeer({
    expectedDataChannels: {
      'reliable': function (channel, data) {
        // Print msg.
        if('string' == typeof data) {
          console.log('onmessage:',channel.label, data);
        } else {
          console.log('onmessage:',channel.label, new Uint8Array(data));
        }

        // Reply.
        if('string' == typeof data) {
          channel.send("Hello peer!");
        } else {
          var response = new Uint8Array([107, 99, 97, 0]);
          channel.send(response.buffer);
        }
      },
    },
    createDataChannels: {
      'zaptastic': {
        outOfOrderAllowed: false,
        maxRetransmitNum: 10,
        onOpen: function (channel) {
          console.log("Data channel", channel.label, "created");
        },
      },
    },
  });

  peer.addDataChannelHandler(function (channel) {
    console.log("Channel open btw:", channel.label);
  });

  peer.addUnexpectedDataChannelCallback(function (channel) {
    console.log("Unexpected data channel rejected (" + channel.label + ").");
  });

  peer.addSendLocalIceCandidateHandler(function (iceCandidate) {
    ws.send(JSON.stringify(iceCandidate));
  });

  peer.addSendAnswerHandler(function (answer) {
    ws.send(JSON.stringify(answer));
  });

  // We don't need to call peer.sendPendingIceCandidates because we can't get
  // to this point in the code without the comm channel being open.  Therefore,
  // we don't start generating ICE candidates until after the channel is open.
  // We will never have to queue any up to send.  Everything will get sent
  // right away.

  // Therefore, we can just return TRUE when asked if we're ready to send.
  peer.addIceXferReadyCallback(function (cb) {
    return true;
  });

  ws.on('message', function(data) {
    data = JSON.parse(data);
    if('offer' == data.type) {
      peer.recvOffer(data);
    } else if('ice' == data.type) {
      peer.recvRemoteIceCandidate(data);
    }
  });
});
