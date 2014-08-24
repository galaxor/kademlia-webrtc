var app = require('express')();
var fs = require('fs');

console.log(process.cwd());

// Set up the webserver.  It should serve index.html in response to /, and any
// other file as is.
app.get('/', function (req, res) {
  var txt = fs.readFileSync('./index.html');
  res.send(''+txt);
});

// XXX I should make this safe by prohibiting .. and absolute paths.
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
    onOffer(socket, offer);
  });

  socket.on('disconnect', function () {
    delete clients[this.client.conn.id];
    if (typeof offers[this.client.conn.id] != "undefined") {
      // The offer may have been deleted when we sent an answer to it, but we
      // may not have received a replacement offer yet.
      delete offers[this.client.conn.id];
      num_offers--;
    }
  });
});
server.listen(5333);


/**
 * When we receive an offer from a newly-connected client, we store it and pass
 * the newcomer one of the offers we have on file.  The newcomer replies with
 * an answer, which we pass to that randomly-chosen client.  When the
 * randomly-chosen client receives the answer, it and the newcomer are
 * communicating.  It also sends a replacement offer to the server.
 */
function onOffer(socket, offer) {
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
          // XXX The client that we created this answer for (the newcomer) may have
          // disconnected before we could reply.  In that case, attempting to
          // reference, or especially emit on, the newcomer's socket will
          // result in some sort of error?  What error?  Find out and try/catch
          // it.
          
          console.log("Received answer from ",id," for ",socket.client.conn.id);
          // We've received answer.  Send it to the newcomer.  Also, delete
          // the now-invalid offer from the list.
          socket.emit('recvanswer', answer);

          delete offers[chosen];
          num_offers--;

          // Remove myself as a listener.  This function only needs to be
          // called once.  It will respond to any 'answer' event by passing the
          // answer to a particular socket.  If we don't remove this handler,
          // then the next time this socket sends an answer, both handlers will
          // fire and this answer will be sent to two sockets.
          this.removeListener('answer', arguments.callee);
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
}
