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

var clone = require("clone");

var BattleRoom = new JS.Class({
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
    //given a player and a pokemon, returns the corresponding pokemon object
    getPokemon: function(battleside, pokename) {
        for(var i = 0; i < battleside.pokemon.length; i++) {
            if(battleside.pokemon[i].name === pokename)
                return battleside.pokemon[i];
        }
        return undefined; //otherwise Pokemon does not exist
    },
    //given a player and a pokemon, updates that pokemon in the battleside object
    updatePokemon: function(battleside, pokemon) {
        for(var i = 0; i < battleside.pokemon.length; i++) {
            if(battleside.pokemon[i].name === pokemon.name) {
                battleside.pokemon[i] = pokemon;
                return;
            }
        }
        logger.info("Could not find " + pokemon.name + " in the battle side, creating new Pokemon.");
        for(var i = battleside.pokemon.length - 1; i >= 0; i--) {
            if(battleside.pokemon[i].name === "Unown") {
                battleside.pokemon[i] = pokemon;
                return;
            }
        }
    },

    //returns true if the player object is us
    isPlayer: function(player) {
        return player === this.side + 'a:';
    },
    // TODO: Understand more about the opposing pokemon
    updatePokemonOnSwitch: function(tokens) {
        var tokens2 = tokens[2].split(' ');
        var tokens4 = tokens[4].split(/\/| /); //for health

        var player = tokens2[0];
        var pokeName = tokens2[1];
        var health = tokens4[0];
        var maxHealth = tokens4[1];

        var battleside = undefined;

        if (this.isPlayer(player)) {
            logger.info("Our pokemon has switched! " + tokens[2]);
            battleside = this.state.p1;
        } else {
            logger.info("Opponents pokemon has switched! " + tokens[2]);
            battleside = this.state.p2;
        }
        var pokemon = this.getPokemon(battleside, pokeName);

        if(!pokemon) { //pokemon has not been defined yet, so choose one of the unowns
            //note: this will not quite work if the pokemon is actually unown
            pokemon = this.getPokemon(battleside, "Unown"); //TODO: make it work for not unowns
            var set = this.state.getTemplate(pokeName);
            set.moves = _.sample(set.randomBattleMoves, 4); //for efficiency, need to implement move ordering
            pokemon = new BattlePokemon(set, this.state.p2);
        }
        //opponent hp is recorded as percentage
        pokemon.hp = health / maxHealth * pokemon.maxhp;
        pokemon.position = 0;
        pokemon.isActive = true;
        this.updatePokemon(battleside,pokemon);
        battleside.active = [pokemon];

        //Ensure that active pokemon is in slot zero
        battleside.pokemon = _.sortBy(battleside.pokemon, function(pokemon) { return pokemon == battleside.active[0] ? 0 : 1 });
    },
    updatePokemonOnDamage: function(tokens) {
        //extract damage dealt to a particular pokemon
        //also takes into account passives
        //note that opponent health is recorded as percent. Keep this in mind

        var tokens2 = tokens[2].split(' ');
        var tokens3 = tokens[3].split('/');
        var player = tokens2[0];
        var pokeName = tokens2[1];
        var health = tokens3[0];
        var maxHealth = tokens3[1];
    },
    updatePokemonOnBoost: function(tokens, isBoost) {
        var tokens2 = tokens[2].split(' ');
        var stat = tokens[3];
        var boostCount = parseInt(tokens[4]);
        var player = tokens2[0];
        var pokeName = tokens2[1];
        if(isBoost) {
            //record the positive boost
        } else {
            //record the negative boost
        }
    },
    updatePokemonRestoreBoost: function(tokens) {
        var tokens2 = tokens[2].split(' ');
        var player = tokens2[0];
        var pokeName = tokens2[1];
    },
    updatePokemonStart: function(tokens) {
        //add condition such as leech seed or ability

        var tokens2 = tokens[2].split(' ');
        var player = tokens2[0];
        var pokeName = tokens2[1];
        var action = tokens[3]; //could be substitute, ability, ...
        if(action.substring(0,4) === 'move') {
            var move = action.substring(6);
        } else if(action.substring(0,7) === 'ability') {
            var ability = action.substring(9);
        } else {
            //something like substitute
        }
    },
    updateField: function(tokens, newField) {
        //as far as I know, only applies to trick room
        var fieldStatus = tokens[2].substring(6);
        if(newField) {
            //add field status
        } else {
            //remove field status
        }
    },
    updateWeather: function(tokens) {
        var weather = tokens[2];
        if(weather === "none") {
            //remove weather
        } else {
            //keep track of weather
            //we might want to keep track of how long the weather has been lasting...
        }
    },
    updateSide: function(tokens, newSide) {
        var player = tokens[2].split(' ')[0];
        var sideStatus = tokens[3].substring(6);
        if(newSide) {
            //add side status
            //Note: can have multiple layers of toxic spikes or spikes
        } else {
            //remove side status
        }
    },
    updatePokemonOnStatus: function(tokens, newStatus) {
        var tokens2 = tokens[2].split(' ');
        var player = tokens2[0];
        var pokeName = tokens2[1];
        var status = tokens[3];
        if(newStatus) {
            //record a new Pokemon's status
            //also keep track of how long the status has been going? relevant for toxic poison
        } else {
            //heal a Pokemon's status
        }
    },
    updatePokemonOnActivate: function(tokens) {
        //activate condition such as protect (is that it?)

        var tokens2 = tokens[2].split(' ');
        var player = tokens2[0];
        var pokeName = tokens2[1];
        var activated = tokens[3];
    },
    updatePokemonOnItem: function(tokens, newItem) {
        //record that a pokemon has an item. Most relevant if a Pokemon has an air balloon/chesto berry

        var tokens2 = tokens[2].split(' ');
        var player = tokens2[0];
        var pokeName = tokens2[1];
        var item = tokens[3];
        if(newItem) {
            //record that a Pokemon does have an item
        } else {
            //record that a Pokemon has lost its item
        }
    },

    //this is going to be very compilcated. There should only be three main cases:
    //-mega evolution. Important if ability change/type change
    //-ditto. Important to check moveset.
    //-zoroark. Also important to check moveset.
    updatePokemonOnDetailsChange: function(tokens) {
        var tokens2 = tokens[2].split(' ');
        var tokens3 = tokens[3].split(', ');
        var player = tokens2[0];
        var pokeName = tokens2[1];
        var newPokeName = tokens3[0];
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
                //Something to keep in mind always: opponent health is recorded as percent.
                //However health is deterministic given a pokemon's species and level, so
                //we can do a conversion to continue to use the built-in battle object.
                if (tokens[1] === 'switch' || tokens[1] === 'drag') {
                    this.updatePokemonOnSwitch(tokens);
                } else if(tokens[i] === 'faint') { //we could outright remove a pokemon...
                    //record that pokemon has fainted
                } else if(tokens[i] === 'detailschange') {
                    this.updatePokemonOnDetailsChange(tokens);
                } else if (tokens[i] === '-damage') {
                    this.updatePokemonOnDamage(tokens);
                } else if(tokens[i] === '-health') {
                    this.updatePokemonOnDamage(tokens);
                } else if(tokens[i] === '-boost') {
                    this.updatePokemonOnBoost(tokens, true);
                } else if(tokens[i] === '-unboost') {
                    this.updatePokemonOnBoost(tokens, false);
                } else if(tokens[i] === '-restoreboost') {
                    this.updatePokemonRestoreBoost(tokens);
                } else if(tokens[i] === '-start') {
                    this.updatePokemonStart(tokens);
                } else if(tokens[i] === '-fieldstart') {
                    this.updateField(tokens, true);
                } else if(tokens[i] === '-fieldend') {
                    this.updateField(tokens, true);
                } else if(tokens[i] === '-weather') {
                    this.updateWeather(tokens);
                } else if(tokens[i] === '-sidestart') {
                    this.updateSide(tokens, true);
                } else if(tokens[i] === '-sideend') {
                    this.updateSide(tokens, false);
                } else if(tokens[i] === '-status') {
                    this.updatePokemonStatus(tokens, true);
                } else if(tokens[i] === '-curestatus') {
                    this.updatePokemonStatus(tokens, false);
                } else if(tokens[i] === '-activate') {
                    this.updatePokemonOnActivate(tokens);
                } else if(tokens[i] === '-item') {
                    this.updatePokemonOnItem(tokens, true);
                } else if(tokens[i] === '-enditem') {
                    this.updatePokemonOnItem(tokens, false);

                    //We don't actually care about the rest of these effects, as they are merely visual
                } else if (tokens[1] === 'move') {
                    //we actually don't need to record anything -- moves are mostly dealt for us
                } else if(tokens[i] === '-supereffective') {

                } else if(tokens[i] === '-crit') {

                } else if(tokens[i] === 'c') {
                    //chat message. Ignore. (or should we? haha)
                } else if(tokens[i] === '-fail') {

                } else if(tokens[i] === '-immune') {

                } else if(tokens[i] === 'message') {

                } else if(tokens[i] === 'cant') {

                } else if(tokens[i] === 'leave') {

                } else if(tokens[i]) { //what if token is defined
                    logger.info("Error: could not parse token '" + tokens[i] + "'. This needs to be implemented");
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

        if (request.side) this.updateSide(request.side, true);

        if (request.active) logger.info(this.title + ": I need to make a move.");
        if (request.forceSwitch) logger.info(this.title + ": I need to make a switch.");

        if (request.active || request.forceSwitch) this.makeMove(request);
    },

    //note: we should not be recreating pokemon each time
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
                item: (pokemon.item || pokemon.item === '') ? '' : Items[pokemon.item].name,
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

            if (pokemon.active) {
                this.state.p1.active = [this.state.p1.pokemon[i]];
                this.state.p1.pokemon[i].isActive = true;
            }

            // TODO(rameshvarun): Somehow parse / load in current hp and status conditions
        }

        // Enforce that the active pokemon is in the first slot
        this.state.p1.pokemon = _.sortBy(this.state.p1.pokemon, function(pokemon) { return pokemon.isActive ? 0 : 1 });

        this.side = sideData.id;
        this.oppSide = (this.side === "p1") ? "p2" : "p1";
        logger.info(this.title + ": My current side is " + this.side);
    },
    makeMove: function(request) {
        var room = this;

        setTimeout(function() {
            var decision = BattleRoom.parseRequest(request);

            var result = minimaxbot.decide(clone(room.state), decision.choices);
            room.decisions.push(result);
            room.send("/choose " + BattleRoom.toChoiceString(result) + "|" + decision.rqid, room.id);
        }, 2000);
    },
    // Static class methods
    extend: {
        toChoiceString: function(choice) {
            if (choice.type == "move") {
                return "move " + choice.id;
            } else if (choice.type == "switch") {
                return "switch " + (choice.id + 1);
            }
        },
        parseRequest: function(request) {
            var choices = [];

            if(!request) return choices; // Empty request

            // If we can make a move
            if (request.active) {
                _.each(request.active[0].moves, function(move) {
                    if (!move.disabled && move.pp > 0) {
                        choices.push({
                            "type": "move",
                            "id": move.id
                        });
                    }
                });
            }

            // Switching options
            var trapped = (request.active) ? (request.active[0].trapped || request.active[0].maybeTrapped) : false;
            var canSwitch = request.forceSwitch || !trapped;
            if (canSwitch) {
                _.each(request.side.pokemon, function(pokemon, index) {
                    if (pokemon.condition.indexOf("fnt") < 0 && !pokemon.active) {
                        choices.push({
                            "type": "switch",
                            "id": index
                        });
                    }
                });
            }

            return {
                rqid: request.rqid,
                choices: choices
            };
        }
    }
});
module.exports = BattleRoom;

var minimaxbot = require("./bots/minimaxbot");
var randombot = require("./bots/randombot");
