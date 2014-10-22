var sockjs = require('sockjs-client-ws');

var client = sockjs.create("http://sim.smogon.com:8000/showdown");

function send(data, room) {
	if (room && room !== 'lobby' && room !== true) {
		data = room+'|'+data;
	} else if (room !== true) {
		data = '|'+data;
	}
	client.write(data);
}

client.on('connection', function() {
	console.log('Connected to server.');
});

client.on('data', function(msg) {
	console.log("Data from server:" + msg);
});

client.on('error', function(e) {

});