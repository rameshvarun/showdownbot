var sockjs = require('sockjs-client-ws');
var request = require('request');
var client = sockjs.create("http://sim.smogon.com:8000/showdown");

var tools = require('tools');

var ACTION_PHP = "http://play.pokemonshowdown.com/~~showdown/action.php";

var account = require("./account.json");


var CHALLENGE_KEY_ID = null;
var CHALLENGE = null;

function send(data, room) {
	if (room && room !== 'lobby' && room !== true) {
		data = room+'|'+data;
	} else if (room !== true) {
		data = '|'+data;
	}
	client.write(data);
}

function rename(name, password) {
	var self = this;
	request.post({
		url : ACTION_PHP,
		formData : {
			act: "login",
			name: name,
			pass: password,
			challengekeyid: CHALLENGE_KEY_ID,
			challenge: CHALLENGE
		}
	},
	function (err, response, body) {
		var data = tools.safeJSON(body);
		if(data && data.curuser && data.curuser.loggedin) {
			send("/trn " + account.username + ",0," + data.assertion);
		} else {
			console.log("Error logging in...");
		}
	});
}

function recieve(data) {
	// TODO(rameshvarun): Handle all the room redirection from client.js:733-801
	var parts;
	if(data.charAt(0) === '|') {
		parts = data.substr(1).split('|');
	} else {
		parts = [];
	}

	switch(parts[0]) {
		case 'challenge-string':
		case 'challstr':
			console.log("Recieved challenge string...");
			CHALLENGE_KEY_ID = parseInt(parts[1], 10);
			CHALLENGE = parts[2];
			rename(account.username, account.password);
			break;
	}
}

client.on('connection', function() {
	console.log('Connected to server.');
	//rename(account.username, account.password);
});

client.on('data', function(msg) {
	console.log("Data from server:" + msg);
	recieve(msg);
});

client.on('error', function(e) {

});