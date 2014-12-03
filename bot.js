// Command-line Arguments
var program = require('commander');
program
	.option('--console', 'Only start the web console - not the game playing bot.')
	.option('--host [url]', 'The websocket endpoint of the host to try to connect to. ["http://sim.smogon.com:8000/showdown"]', 'http://sim.smogon.com:8000/showdown')
	.option('--port [port]', 'The port on which to serve the web console. [3000]', "3000")
	.option('--ranked', 'Challenge on the ranked league.')
	.option('--net [action]', "'create' - generate a new network. 'update' - use and modify existing network. 'use' - use, but don't modify network. 'none' - use hardcoded weights. ['none']", 'none')
	.option('--algorithm [algorithm]', "Can be 'minimax', 'greedy', or 'random'. ['minimax']", "minimax")
	.option('--account [file]', "File from which to load credentials. ['account.json']", "account.json")
	.option('--nosave', "Don't save games to the in-memeory db.")
	.option('--nolog', "Don't append to log files.")
        .option('--startchallenging', "Start out challenging, instead of
requiring a manual activation first.")
	.parse(process.argv);

var request = require('request'); // Used for making post requests to login server
var util = require('./util');
var fs = require('fs');

// Setup Logging
var log4js = require('log4js');
log4js.loadAppender('file');
var logger = require('log4js').getLogger("bot");

if(!program.nolog) {
	// Ensure that logging directory exists
	if(!fs.existsSync("./logs")) { fs.mkdirSync("logs") };

	log4js.addAppender(log4js.appenders.file('logs/bot.log'), 'bot');

	log4js.addAppender(log4js.appenders.file('logs/minimax.log'), 'minimax');
	log4js.addAppender(log4js.appenders.file('logs/learning.log'), 'learning');

	log4js.addAppender(log4js.appenders.file('logs/battleroom.log'), 'battleroom');
	log4js.addAppender(log4js.appenders.file('logs/decisions.log'), 'decisions');

	log4js.addAppender(log4js.appenders.file('logs/webconsole.log'), 'webconsole');

	log4js.addAppender(log4js.appenders.file('logs/battle.log'), 'battle');
	log4js.addAppender(log4js.appenders.file('logs/battlepokemon.log'), 'battlepokemon');
	log4js.addAppender(log4js.appenders.file('logs/battleside.log'), 'battleside');

	log4js.addAppender(log4js.appenders.file('logs/greedy.log'), 'greedy');
} else {
	logger.setLevel("INFO");
	log4js.configure({
		appenders : [
			{
				type: "console",
				category: ["bot"]
			}
		]
	});
}

// Login information for this bot
var account = JSON.parse(fs.readFileSync(program.account));
module.exports.account = account;

var webconsole = require("./console.js");// Web console

// Connect to server
var sockjs = require('sockjs-client-ws');
var client = null;
if(!program.console) client = sockjs.create(program.host);

// Domain (replay button redirects here)
var DOMAIN = "http://play.pokemonshowdown.com/";
exports.DOMAIN = DOMAIN;

// PHP endpoint used to login / authenticate
var ACTION_PHP = DOMAIN + "~~showdown/action.php";

// Values that need to be globally stored in order to login properly
var CHALLENGE_KEY_ID = null;
var CHALLENGE = null;

// BattleRoom object
var BattleRoom = require('./battleroom');

// The game type that we want to search for on startup
var GAME_TYPE = (program.ranked) ? "randombattle" : "unratedrandombattle";

// Load in Game Data
var Pokedex = require("./data/pokedex");
var Typechart = require("./data/typechart");

// Sends a piece of data to the given room
// Room can be null for a global command
var send = module.exports.send = function(data, room) {
	if (room && room !== 'lobby' && room !== true) {
		data = room+'|'+data;
	} else if (room !== true) {
		data = '|'+data;
	}
	client.write(data);

	logger.trace(">> " + data);
}

// Login to a new account
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
		var data = util.safeJSON(body);
		if(data && data.curuser && data.curuser.loggedin) {
			send("/trn " + account.username + ",0," + data.assertion);
		} else {
			// We couldn't log in for some reason
			logger.fatal("Error logging in...");
			process.exit();
		}
	});
}

// Global room counter (this allows multiple battles at the same time)
var ROOMS = {};
exports.ROOMS = ROOMS;

// Add a new room (only supports rooms of type battle)
function addRoom(id, type) {
	if(type == "battle") {
		ROOMS[id] = new BattleRoom(id, send);
		return ROOMS[id];
	} else {
		logger.error("Unkown room type: " + type);
	}
}
// Remove a room from the global list
function removeRoom(id) {
	var room = ROOMS[id];
	if(room) {
		delete ROOMS[id];
		return true;
	}
	return false;
}

// Code to execute once we have succesfully authenticated
function onLogin() {
    //do nothing


}

function searchBattle() {
	logger.info("Searching for an unranked random battle");
    send("/search " + GAME_TYPE);
}
module.exports.searchBattle = searchBattle;

// Global recieve function - tries to interpret command, or send to the correct room
function recieve(data) {
	logger.trace("<< " + data);

	var roomid = '';
	if (data.substr(0,1) === '>') { // First determine if this command is for a room
	    var nlIndex = data.indexOf('\n');
		if (nlIndex < 0) return;
		roomid = util.toRoomid(data.substr(1,nlIndex-1));
		data = data.substr(nlIndex+1);
	}
	if (data.substr(0,6) === '|init|') { // If it is an init command, create the room
		if (!roomid) roomid = 'lobby';
		var roomType = data.substr(6);
		var roomTypeLFIndex = roomType.indexOf('\n');
		if (roomTypeLFIndex >= 0) roomType = roomType.substr(0, roomTypeLFIndex);
		roomType = util.toId(roomType);

		logger.info(roomid + " is being opened.");
		addRoom(roomid, roomType);

	} else if ((data+'|').substr(0,8) === '|expire|') { // Room expiring
		var room = ROOMS[roomid];
		logger.info(roomid + " has expired.");
		if(room) {
			room.expired = true;
			if (room.updateUser) room.updateUser();
		}
		return;
	} else if ((data+'|').substr(0,8) === '|deinit|' || (data+'|').substr(0,8) === '|noinit|') {
		if (!roomid) roomid = 'lobby';

		// expired rooms aren't closed when left
		if (ROOMS[roomid] && ROOMS[roomid].expired) return;

		logger.info(roomid + " has been closed.");
		removeRoom(roomid);
		return;
	}
	if(roomid) { //Forward command to specific room
		if(ROOMS[roomid]) {
			ROOMS[roomid].recieve(data);
		} else {
			log.error("Room of id " + roomid + " does not exist to send data to.");
		}
		return;
	}

	// Split global command into parts
	var parts;
	if(data.charAt(0) === '|') {
		parts = data.substr(1).split('|');
	} else {
		parts = [];
	}

	switch(parts[0]) {
		// Recieved challenge string
		case 'challenge-string':
		case 'challstr':
			logger.info("Recieved challenge string...");
			CHALLENGE_KEY_ID = parseInt(parts[1], 10);
			CHALLENGE = parts[2];

			// Now try to rename to the given user
			rename(account.username, account.password);
			break;
		// Server is telling us to update the user that we are currently logged in as
		case 'updateuser':
			// The update user command can actually come with a second command (after the newline)
			var nlIndex = data.indexOf('\n');
			if (nlIndex > 0) {
				recieve(data.substr(nlIndex+1));
				nlIndex = parts[3].indexOf('\n');
				parts[3] = parts[3].substr(0, nlIndex);
			}

			var name = parts[1];
			var named = !!+parts[2];

			if(name == account.username) {
				logger.info("Successfully logged in.");
				onLogin()
			}
			break;
		// Server tried to send us a popup
		case 'popup':
			logger.info("Popup: " + data.substr(7).replace(/\|\|/g, '\n'));
			break;
		// Someone has challenged us to a battle
		case 'updatechallenges':
			var challenges = JSON.parse(data.substr(18));
			if(challenges.challengesFrom) {
				for(var user in challenges.challengesFrom) {
					if(challenges.challengesFrom[user] == "randombattle") {
						logger.info("Accepting challenge from " + user);
						send("/accept " + user);
					}
				}
			}
		// Unkown global command
		default:
			logger.warn("Did not recognize command of type: " + parts[0]);
			break;
	}
}

if(client) {
	client.on('connection', function() {
		logger.info('Connected to server.');
	});

	client.on('data', function(msg) {
		recieve(msg);
	});

	client.on('error', function(e) {
		logger.error(e);
	});
}
