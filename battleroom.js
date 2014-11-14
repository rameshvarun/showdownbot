// Class libary
JS = require('jsclass');
JS.require('JS.Class');

//does this work? will it show up?

require("sugar");

// Account file
var account = require("./account.json");

// Results database
var db = require("./db");

// Logging
var log4js = require('log4js');
var logger = require('log4js').getLogger("battleroom");
var decisionslogger = require('log4js').getLogger("decisions");
log4js.addAppender(log4js.appenders.file('logs/battleroom.log'), 'battleroom');
log4js.addAppender(log4js.appenders.file('logs/decisions.log'), 'decisions');

//battle-engine
var Battle = require('./battle-engine/battle');
var BattlePokemon = require('./battle-engine/battlepokemon');

var Abilities = require("./data/abilities").BattleAbilities;
var Items = require("./data/items").BattleItems;

var _ = require("underscore");

var minimax = require("./minimax");

module.exports = new JS.Class({
    initialize: function(id, sendfunc) {
        this.id = id;
        this.title = "Untitled";
        this.send = sendfunc;

        //TODO: we assume that we are p1, but this is not always the case
        this.state = Battle.construct(id, 'base', false);
        this.state.join('p1', 'botPlayer');
        this.state.join('p2', 'humanPlayer');

        setTimeout(function() {
            sendfunc(account.message, id); // Notify User that this is a bot
            sendfunc("/timer", id); // Start timer (for user leaving or bot screw ups)
        }, 10000);

        this.decisions = [];
        this.log = "";
    },
    init: function(data) {
        var log = data.split('\n');
        if (data.substr(0, 6) === '|init|') {
            log.shift();
        }
        if (log.length && log[0].substr(0, 7) === '|title|') {
            this.title = log[0].substr(7);
            log.shift();
            logger.info("Title for " + this.id + " is " + this.title);
        }
    },
    recieve: function(data) {
        if (!data) return;

        logger.trace("<< " + data);

        if (data.substr(0, 6) === '|init|') {
            return this.init(data);
        }
        if (data.substr(0, 9) === '|request|') {
            return this.receiveRequest(JSON.parse(data.substr(9)));
        }

        var log = data.split('\n');
        for (var i = 0; i < log.length; i++) {
            this.log += log[i] + "\n";

            var tokens = log[i].split('|');
            if (tokens.length > 1) {

                if (tokens[1] === 'tier') {
                    this.tier = tokens[2];
                }

                if (tokens[1] === 'win') {
                    this.send("gg", this.id);

                    this.winner = tokens[2];
                    if (this.winner == account.username) {
                        logger.info(this.title + ": I won this game");
                    } else {
                        logger.info(this.title + ": I lost this game");
                    }

                    this.saveResult();

                    // Leave in two seconds
                    var battleroom = this;
                    setTimeout(function() {
                        battleroom.send("/leave " + battleroom.id);
                    }, 2000);

                }

                // TODO: Make sure we set the opponent bokemon in the battle object
                if (tokens[1] === 'switch' || tokens[1] === 'drag') {
                    logger.info("Oppnents pokemon has switched! " + tokens[2]);
                    var tokens2 = tokens[2].split(' ');
                    if (tokens2[0] === this.oppSide + 'a:') { //TODO: opponent might not be p2a
                        var oldPokemon = this.oppPokemon;

                        // TODO: Understand more about the opposing pokemon
                        var set = this.state.getTemplate(tokens2[1]);
                        set.moves = set.randomBattleMoves;
                        
                        this.oppPokemon = new BattlePokemon(set, this.state.p2);
                        this.oppPokemon.position = 0;
                        this.state.p2.pokemon[0] = this.oppPokemon;
                        this.state.p2.active = [this.oppPokemon];

                        logger.info("Opponent Switches To: " + this.oppPokemon.name);

                        if (this.request.active) {
                            this.makeMove(this.request.rqid);
                        }
                    }
                } else if (tokens[1] === 'move') {

                }
            }
        }
    },
    saveResult: function() {
        // Save game data to data base
        game = {
            "title": this.title,
            "id": this.id,
            "win": (this.winner == account.username),
            "date": new Date(),
            "decisions": JSON.stringify(this.decisions),
            "log": this.log,
            "tier": this.tier
        }
        db.insert(game, function(err, newDoc) {
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
        if (!sideData || !sideData.id) return;

        logger.info("Starting to update my side data.");
        for (var i = 0; i < sideData.pokemon.length; ++i) {
            var pokemon = sideData.pokemon[i];

            var details = pokemon.details.split(",");
            var name = details[0].trim();
            var level = parseInt(details[1].trim().substring(1));
            var gender = details[2] ? details[2].trim() : null;

            var template = {
                name: name,
                moves: pokemon.moves,
                ability: Abilities[pokemon.baseAbility].name,
                evs: {
                    hp: 85,
                    atk: 85,
                    def: 85,
                    spa: 85,
                    spd: 85,
                    spe: 85
                },
                ivs: {
                    hp: 31,
                    atk: 31,
                    def: 31,
                    spa: 31,
                    spd: 31,
                    spe: 31
                },
                item: (pokemon.item === '') ? '' : Items[pokemon.item].name,
                level: level,
                active: pokemon.active,
                shiny: false
            };

            // Initialize pokemon
            this.state.p1.pokemon[i] = new BattlePokemon(template, this.state.p1);
            this.state.p1.pokemon[i].position = i;

            // Update the pokemon object with latest stats
            for (var stat in pokemon.stats) {
                this.state.p1.pokemon[i].baseStats[stat] = pokemon.stats[stat];
            }

            if(pokemon.active) {
                this.state.p1.active = [this.state.p1.pokemon[i]];
            }

            // TODO(rameshvarun): Somehow parse / load in current hp and status conditions
        }

        this.side = sideData.id;
        this.oppSide = (this.side === "p1") ? "p2" : "p1";
        logger.info(this.title + ": My current side is " + this.side);
    },
    makeMove: function(rqid) {
        if (this.oppPokemon === '' || !this.oppPokemon) { //try again after some time
            logger.info("Can't make a move until we determine opponent Pokemon!");
            return;
        }

        var choices = [];

        _.each(this.request.active[0].moves, function(move) {
            if (!move.disabled && move.pp > 0) {
                choices.push({
                    "type": "move",
                    "id": move.id
                });
            }
        });

        // Determine if we can switch pokemon
        if (!this.request.active[0].trapped && !this.request.active[0].maybeTrapped) {
            _.each(this.request.side.pokemon, function(pokemon, index) {
                if (pokemon.condition.indexOf("fnt") < 0 && !pokemon.active) {
                    choices.push({
                        "type": "switch",
                        "id": index
                    });
                }
            });
        }

        var result = minimax.decide(this.state, choices);
        this.send("/choose " + minimax.toChoiceString(result) + "|" + rqid, this.id);
    },
    makeSwitch: function(rqid, pokemon) {
        var choices = [];
        _.each(this.request.side.pokemon, function(pokemon, index) {
            if (pokemon.condition.indexOf("fnt") < 0 && !pokemon.active) {
                choices.push({
                    "type": "switch",
                    "id": index
                });
            }
        });

        var result = minimax.decide(this.state, choices);
        this.send("/choose " + minimax.toChoiceString(result) + "|" + rqid, this.id);
    },
    notifyRequest: function() {
        switch (this.request.requestType) {
            case 'move':
                logger.info(this.title + ": I need to make a move.");
                this.makeMove(this.request.rqid);
                break;
            case 'switch':
                logger.info(this.title + ": I need to make a switch.");
                this.makeSwitch(this.request.rqid);
                break;
            case 'team':
                logger.info(this.title + ": I need to pick my team order.");
                break;
        }
    }
});
