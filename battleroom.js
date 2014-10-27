// Class libary
JS = require('jsclass');
JS.require('JS.Class');

// Account file
var account = require("./account.json");

// Logging
var logger = require('log4js').getLogger("BattleRoom");

module.exports = new JS.Class({
	initialize: function(id, sendfunc) {
		this.id = id;
		this.title = "Untitled";
		this.send = sendfunc

		setTimeout(function() {
			sendfunc(account.message, id);
		}, 10000)
	},
	init: function(data) {
		var log = data.split('\n');
		if (data.substr(0,6) === '|init|') log.shift();
		if (log.length && log[0].substr(0, 7) === '|title|') {
			this.title = log[0].substr(7);
			log.shift();
			logger.info("Title for " + this.id + " is " + this.title);
		}
	},
	recieve: function(data) {
		if (!data) return;
		if (data.substr(0,6) === '|init|') {
			return this.init(data);
		}
		if (data.substr(0,9) === '|request|') {
			return this.receiveRequest(JSON.parse(data.substr(9)));
		}
	},
	receiveRequest: function(request) {
		if (!request) {
			this.side = '';
			return;
		}

		request.requestType = null;
		var notifyObject = null;
		if (request.active) {
			request.requestType = "move";
		} else if (request.forceSwitch) {
			request.requestType = 'switch';
		} else if (request.teamPreview) {
			request.requestType = 'team';
		} else if (request.wait) {
			request.requestType = 'wait';
		}

		this.choice = null;
		this.request = request;
		if (request.side) {
			this.updateSideLocation(request.side, true);
		}
		this.notifyRequest();
	},
	updateSideLocation: function(sideData, midBattle) {
		if (!sideData.id) return;
		this.side = sideData.id;
		logger.info(this.title + ": My current side is " + this.side);
	},
	makeMove: function(rqid, moves) {
		var move = moves[Math.floor(Math.random()*moves.length)];
		this.send("/choose move " + move.move + "|" + rqid,this.id);
	},
	makeSwitch: function(rqid, pokemon) {
		var choices = [];
		for(var i = 0; i < pokemon.length; ++i) {
			if(pokemon[i].condition.indexOf("fnt") < 0 && !pokemon[i].active)
				choices.push(i + 1);
		}
		var choice = choices[Math.floor(Math.random()*choices.length)];
		this.send("/choose switch " + choice + "|" + rqid, this.id);
	},
	notifyRequest: function() {
		switch (this.request.requestType) {
			case 'move':
				logger.info(this.title + ": I need to make a move.");
				this.makeMove(this.request.rqid, this.request.active[0].moves);
				break;
			case 'switch':
				logger.info(this.title + ": I need to make a switch.");
				this.makeSwitch(this.request.rqid, this.request.side.pokemon);
				break;
			case 'team':
				logger.info(this.title + ": I need to pick my team order.");
				break;
		}
	}
});