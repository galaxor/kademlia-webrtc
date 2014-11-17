var static = require('node-static-alias');
var http = require('http');
var ws = require('ws');

var args = require('minimist')(process.argv.slice(2));
var host = args.h || '127.0.0.1';
var port = args.p || 8080;
var socketPort = args.ws || 9001;

var file = new static.Server('./', {
    alias: [
      {
        match: '/dist/wrtc.js',
        serve: '../node_modules/wrtc/dist/wrtc.js',
        allowOutside: true
      },
      {
        match: '/WebRTCPeer.js',
        serve: '../node_modules/WebRTCPeer/WebRTCPeer.js',
        allowOutside: true
      },
      {
        match: '/jquery-1.11.1.min.js',
        serve: '../jquery-1.11.1.min.js',
        allowOutside: true
      },
    ],
    });

var app = http.createServer(function (req, res) {
    console.log(req.url);
    req.addListener('end', function() {
        file.serve(req, res);
      }).resume();

}).listen(port, host);
console.log('Server running at http://' + host + ':' + port + '/');

var peers = {};

var wss = new ws.Server({'port': socketPort});
wss.on('connection', function(ws) {
  console.info('~~~~~ ws connected ~~~~~~');

  ws.on('message', function(msg) {
    console.log("Beep blop", msg);
    var data = JSON.parse(msg);
    console.log("Got ", data);
    if (data.type == 'offer') {
      console.log("Storing offer", data.offer);
      peers[1] = {ws: ws, offer: data.offer};
    } else if (data.type == 'getOffer') {
      peers[2] = {ws: ws};
      var outmsg = {
        type: 'offer',
        from: 1,
        offer: peers[1].offer,
      };
      console.log("Sending offer to 2", outmsg);
      peers[2].ws.send(JSON.stringify(outmsg));
    } else if (data.type == 'answer') {
      console.log("Relaying answer to 1:", data);
      peers[1].ws.send(msg);
    } else if (data.type == 'ice') {
      var to = (data.from==1)? 2 : 1;
      console.log("Sending ice to ", to, ":", data);
      peers[to].ws.send(msg);
    }
  });
});
