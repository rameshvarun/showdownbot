// Class libary
JS = require('jsclass');
JS.require('JS.Class');

require("sugar")

// Account file
var account = require("./account.json");

// Results database
var db = require("./db");

// Logging
var log4js = require('log4js');
var logger = require('log4js').getLogger("battleroom");
log4js.addAppender(log4js.appenders.file('logs/battleroom.log'), 'battleroom');

//battle-engine
var Battle = require('./battle-engine/battle');
var BattlePokemon = require('./battle-engine/battlepokemon');

var Abilities = require("./data/abilities").BattleAbilities
var Items = require("./data/items").BattleItems

var _ = require("underscore")

module.exports = new JS.Class({
	initialize: function(id, sendfunc) {
	    this.id = id;
	    this.title = "Untitled";
	    this.send = sendfunc;
            this.oppPokemon = '';

	    //for now, assume that we are p1
            this.state = Battle.construct(id, 'base', false);
            this.state.join('p1','botPlayer');
            this.state.join('p2','humanPlayer');

	    setTimeout(function() {
		sendfunc(account.message, id); // Notify User that this is a bot
		sendfunc("/timer", id); // Start timer (for user leaving or bot screw ups)
	    }, 10000);
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

		logger.trace("<< " + data);

		if (data.substr(0,6) === '|init|') {
			return this.init(data);
		}
		if (data.substr(0,9) === '|request|') {
			return this.receiveRequest(JSON.parse(data.substr(9)));
		}

		var log = data.split('\n');
		for (var i = 0; i < log.length; i++) {
                    var tokens = log[i].split('|');
                    if(tokens.length > 1) {
		        if (tokens[1] === 'win') {
			    this.send("Good game!", this.id);

			    this.winner = tokens[2];
			    if(this.winner == account.username) {
			        logger.info(this.title + ": I won this game");
			    } else {
			        logger.info(this.title + ": I lost this game");
			    }

			    this.saveResult();
			    this.send("/leave " + this.id);
		        }
                        if (tokens[1] === 'switch') {
                            logger.info("Hey! Switcheroo! " + tokens[2]);
                            var tokens2 = tokens[2].split(' ');
                            if(tokens2[0] === 'p2a:') {
                                this.oppPokemon = new BattlePokemon(this.state.getTemplate(tokens2[1]), this.state.p2);
                                logger.info(this.oppPokemon);
                            }
                        } else if(tokens[1] === 'move') {

                        }
                    }
		}
	},
	saveResult: function() {
		this.send("/savereplay", this.id); // Tell showdown to save a replay of this game
		game = {
			"title" : this.title,
			"id" : this.id,
			"win" : (this.winner == account.username),
			"date" : new Date()
		}
		db.insert(game, function (err, newDoc) {
			logger.info("Saved result of " + newDoc.title + " to database.");
		});
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
			this.updateSide(request.side, true);
		}
		this.notifyRequest();
	},
	updateSide: function(sideData) {
		if(!sideData || !sideData.id) return;

		logger.info("Starting to update my side data.");
		for(var i = 0; i < sideData.pokemon.length; ++i) {
			var pokemon = sideData.pokemon[i];

			var details = pokemon.details.split(",");
			var name = details[0].trim();
			var level = parseInt(details[1].trim().substring(1));
			var gender = details[2] ? details[2].trim() : null;

			var template = {
				name : name,
				moves : pokemon.moves,
				ability : Abilities[pokemon.baseAbility].name,
				evs : {
					hp: 85,
					atk: 85,
					def: 85,
					spa: 85,
					spd: 85,
					spe: 85
				},
				ivs : {
					hp: 31,
					atk: 31,
					def: 31,
					spa: 31,
					spd: 31,
					spe: 31
				},
				item : (pokemon.item === '') ? '' : Items[pokemon.item].name,
				level : level,
				shiny : false
			};

			// Initialize pokemon
			this.state.p1.pokemon[i] = new BattlePokemon(template, this.state.p1);

			// Update the pokemon object with latest stats
			for(var stat in pokemon.stats) {
				this.state.p1.pokemon[i].baseStats[stat] = pokemon.stats[stat];
			}

			// TODO(rameshvarun): Somehow parse / load in current hp and status conditions
		}

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
				choices.push(i);
		}

		var battleroom = this;

		var scores = {}
		var reason = {}
		_.each(choices, function(choice) {
			var pokemon = battleroom.state.p1.pokemon[choice];
			scores[choice] = 0;
			reason[choice] = pokemon.name + " - " + scores[choice];
		});
		choices.sort(function(a, b) {
			return scores[b] - scores[a];
		});

		// Print reasons
		_.each(choices, function(choice) {
			logger.debug(reason[choice])
		});

		var choice = choices[0]; // Pick best pokemon
		this.send("/choose switch " + (choice + 1) + "|" + rqid, this.id);
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
