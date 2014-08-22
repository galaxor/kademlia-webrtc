var app = require('express')();
var fs = require('fs');

console.log(process.cwd());

app.get('/', function (req, res) {
  var txt = fs.readFileSync('./sockettome.html');
  res.send(''+txt);
});

app.get('/:filename', function (req, res) {
  var txt = fs.readFileSync('./'+req.params.filename);
  res.send(''+txt);
});


var server = require('http').Server(app);
var io = require('socket.io')(server);

var clients = {};

io.on('connection', function (socket){ 
  clients[socket.client.conn.id] = socket;

  socket.emit('hello', {ok: 'tralala'});
  socket.on('pronoun', function (data) {
    console.log("Pronouned");
    console.log(data);
  });
  socket.on('disconnect', function () {
    delete clients[this.client.conn.id];
  });
});
server.listen(5333);
