var app = require('express')();
var fs = require('fs');

console.log(process.cwd());

app.get('/', function (req, res) {
  var txt = fs.readFileSync('./index.html');
  res.send(''+txt);
});

app.get('/:filename', function (req, res) {
  var txt = fs.readFileSync('./'+req.params.filename);
  res.send(''+txt);
});


var server = require('http').Server(app);
var io = require('socket.io')(server);

var clients = {};
var num_offers = 0;
var offers = {};

io.on('connection', function (socket){ 
  clients[socket.client.conn.id] = socket;

  socket.on('offer', function (offer) {
    console.log("Received offer from ", socket.client.conn.id);
    console.log("This is offer #"+(num_offers+1));

    // If there's already a pending offer, then let's send it to the newcomer.
    if (num_offers > 0) {
      var chosen = Math.floor(Math.random()*num_offers);
      var i=0;
      for (var id in offers) {
        console.log("Investiating ",id,"Looking at #",i," looking for ",chosen);
        if (i == chosen) {
          // Prepare to receive an answer from the chosen client.
          clients[id].on('answer', function (answer) {
            console.log("Received answer from ",id," for ",socket.client.conn.id);
            // XXX The reply to 'createanswer' should contain a replacement
            // offer for use next time.

            // We've received answer.  Send it to the newcomer.  Also, delete
            // the now-invalid offer from the list.
            socket.emit('recvanswer', answer);
          });

          // instruct the chosen client to create answer.
          console.log("Instructed client ",id," to create answer for the newcomer.");
          clients[id].emit('createanswer', offer);

          break;
        }
        i++;
      }
    }

    // Store the newcomer's offer for later.
    offers[socket.client.conn.id] = offer;
    num_offers += 1;
  });

  socket.on('disconnect', function () {
    delete clients[this.client.conn.id];
  });
});
server.listen(5333);
