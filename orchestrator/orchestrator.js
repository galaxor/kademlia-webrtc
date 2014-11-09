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
        serve: '../node_modules/wrtc/dist/wrtc.js',
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

var members = {};

var wss = new ws.Server({'port': socketPort});
var nextId = 1;
wss.on('connection', function(ws) {
  console.info('~~~~~ ws connected ~~~~~~');

  var myId = nextId;
  var ids = Object.keys(members);
  ws.send(JSON.stringify({type: 'createOffer', peers: ids, id: myId}));
  members[myId] = ws;
  nextId++;

  ws.on('message', function(msg) {
    console.log("Straight msg", msg);
    var data = JSON.parse(msg);
    console.log("Recvd", data);
    if (data.type == 'offers') {
      console.log("Recvd offers", data);
      console.log("Offers", data.offers);
      data.offers.forEach(function (offerMsg) {
        var to = offerMsg.to;
        var sendOffer = {
          type: 'offer',
          from: data.from,
          to: to,
          offer: offerMsg.offer,
        };
        members[to].send(JSON.stringify(sendOffer));
      });
    } else {
      members[data.to].send(JSON.stringify(data));
    }
  });

  ws.on('close', function () {
    delete members[myId];
  });
});
