// Class libary
JS = require('jsclass');
JS.require('JS.Class');

// Account file
var account = require("./account.json");

// Results database
var db = require("./db");

// Logging
var logger = require('log4js').getLogger("BattleRoom");

//battle-engine
var BattleEngine = require('./battle-engine');
var BattlePokemon = BattleEngine.BattlePokemon;
var BattleSide = BattleEngine.BattleSide;
var Battle = BattleEngine.Battle;

module.exports = new JS.Class({
	initialize: function(id, sendfunc) {
		this.id = id;
		this.title = "Untitled";
		this.send = sendfunc;
                this.state = new Battle();

                //for now, assume that we are p1

		setTimeout(function() {
			sendfunc(account.message, id);
		}, 10000);

		setTimeout(function() {
			sendfunc("/timer", id);
		}, 10000)

		//TODO(rameshvarun): Start the timer after a couple minutes (to ensure that battles finish)
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
        processData: function(data) {
            //This is data reported by the server. Parse each line of code.
            //Different things to parse:
            //1. |switch|p1a: Pokemon|POkemon, L70|264/264
            //2. |move|p1a: Ho-oh|Tailwind|pqa: Ho-oh

            //The rest are possible side effects... Important to distinguish
            //3. |-sidestart|p1: greedybot|move: Tailwind
            //4. |-weather|Hail|[upkeep]
            //5. |-damage|p1a: Ho-Oh|248/264|[from] hail
            //6. |-heal|p1a: Ho-Oh|248/264|[from] Leftovers
            //and various other messages... we can sift through the messages
            var dataLines = data.split('\n');
                var turn = '';
            var myPlayerId = 'p1a'; //for now assume that we're p1
            for(var i in data.split('\n')) {
                logger.trace('data data! ' + dataLines[i]);
                var tokens = dataLines[i].split('|');
                logger.trace(tokens);
                if(tokens.length > 1) {
                    if(tokens[1] === 'move') {
                        logger.trace("a move!");
                    } else if(tokens[1]  === 'switch') {
                        //check if new Pokemon
                        logger.trace('a switch!');
                        var playerTokens = tokens[2].split(' ');
                        var isNew = true;
                        if(playerTokens[0] === myPlayerId) {
                            this.state.playerState.pokemon
                                .forEach(function(pokemon) {
                                             if(pokemon.name ===
                                                playerTokens[1]) {
                                                 isNew = false;
                                             }
                                         });
                            /*if(isNew) {
                                this.state.playerState.pokemon.push(new
                                                                    BattlePokemon(playerTokens[1],
                            }*/
                        }
                        //restore Pokemon state otherwise
                    } else if(tokens[1] === 'faint') {
                        logger.trace('a ko!');
                    }
                }
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
            if(data.substr(0,3) === '\n|\n') {
                this.processData(data);
            }
		var log = data.split('\n');
		for (var i = 0; i < log.length; i++) {
			var logLine = log[i];

			if (logLine.substr(0, 5) === '|win|') {
				this.send("Good game!", this.id);

				this.winner = logLine.substr(5);
				if(this.winner == account.username) {
					logger.info(this.title + ": I won this game");
				} else {
					logger.info(this.title + ": I lost this game");
				}

				this.send("/leave " + this.id);
			}
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
                //TODO(harrison8989): choose mega evolution when possible
                //TODO(harrison8989): implement greedy algorithm
                /*
                  Steps to victory:
                  1. construct object that replicates opponent's state
                  2. implement type advantages/figure out how they work
                  2.5 a pokemon has a type...
                  3. first part of greedy: maximum amount of damage/use a thing
                  4. second part of greedy: if in disadvantageous situation, switch
            */
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
            /*for(key in this.request) {
                logger.info("Key: " + key);
                logger.info(this.request[key]);
            }*/


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
