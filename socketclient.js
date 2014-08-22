$(document).ready(function () {
  $('body').append("Boyeee");

  var socket = io('http://localhost:5333');
  socket.on('connect', function () {
    console.log("Hi there!");
    socket.on('hello', function (data) {
      console.log(data);
    });
    socket.on('hullo', function (data) {
      console.log(data);
    });
    $('#clickme').click(function () {
      console.log("pronouning");
      socket.emit('pronoun', {pronoun: 'zee'});
    });
  });
});
