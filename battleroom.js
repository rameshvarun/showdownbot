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

var clone = require("./clone");

var BattleRoom = new JS.Class({
    initialize: function(id, sendfunc) {
        this.id = id;
        this.title = "Untitled";
        this.send = sendfunc;

        //TODO: we assume that we are p1, but this is not always the case
        this.state = Battle.construct(id, 'base', false);
        this.state.join('p1', 'botPlayer');
        this.state.join('p2', 'humanPlayer');
        this.state.reportPercentages = true;

        setTimeout(function() {
            sendfunc(account.message, id); // Notify User that this is a bot
            sendfunc("/timer", id); // Start timer (for user leaving or bot screw ups)
        }, 10000);

        this.decisions = [];
        this.log = "";

        this.state.start();
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
    getPokemon: function(battleside, pokename, temp) {
        for(var i = 0; i < battleside.pokemon.length; i++) {
            if(battleside.pokemon[i].name === pokename || //for mega pokemon
               battleside.pokemon[i].name.substr(0,pokename.length) === pokename)
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
        return player === this.side + 'a:' || player === this.side + ':';
    },
    // TODO: Understand more about the opposing pokemon
    updatePokemonOnSwitch: function(tokens) {
        var tokens2 = tokens[2].split(' ');
        var level = tokens[3].split(', ')[1].substring(1);
        var tokens4 = tokens[4].split(/\/| /); //for health

        var player = tokens2[0];
        var pokeName = tokens2[1];
        var health = tokens4[0];
        var maxHealth = tokens4[1];

        var battleside = undefined;

        if (this.isPlayer(player)) {
            logger.info("Our pokemon has switched! " + tokens[2]);
            battleside = this.state.p1;
            //remove boosts for current pokemon
            this.state.p1.active[0].boosts = {};
            this.state.p1.active[0].volatiles = {};
        } else {
            logger.info("Opponents pokemon has switched! " + tokens[2]);
            battleside = this.state.p2;
            //remove boosts for current pokemon
            this.state.p2.active[0].boosts = {};
            this.state.p2.active[0].volatiles = {};
        }
        var pokemon = this.getPokemon(battleside, pokeName);

        if(!pokemon) { //pokemon has not been defined yet, so choose one of the unowns
            //note: this will not quite work if the pokemon is actually unown
            pokemon = this.getPokemon(battleside, "Unown"); //TODO: make it work for not unowns
            var set = this.state.getTemplate(pokeName);
            set.moves = _.sample(set.randomBattleMoves, 4); //for efficiency, need to implement move ordering
            set.level = parseInt(level);
            pokemon = new BattlePokemon(set, battleside);
        }
        //opponent hp is recorded as percentage
        pokemon.hp = Math.ceil(health / maxHealth * pokemon.maxhp);
        pokemon.position = 0;
        pokemon.isActive = true;
        this.updatePokemon(battleside,pokemon);

        if(this.isPlayer(player)) {
            this.state.p1.active[0].isActive = false;
            this.state.p1.active = [pokemon];
        } else {
            this.state.p2.active[0].isActive = false;
            this.state.p2.active = [pokemon];
        }


        //Ensure that active pokemon is in slot zero
        battleside.pokemon = _.sortBy(battleside.pokemon, function(pokemon) { return pokemon == battleside.active[0] ? 0 : 1 });
    },
    updatePokemonOnDamage: function(tokens) {
        //extract damage dealt to a particular pokemon
        //also takes into account passives
        //note that opponent health is recorded as percent. Keep this in mind

        var tokens2 = tokens[2].split(' ');
        var tokens3 = tokens[3].split(/\/| /);
        var player = tokens2[0];
        var pokeName = tokens2[1];
        var health = tokens3[0];
        var maxHealth = tokens3[1];
        var battleside = undefined;

        if(this.isPlayer(player)) {
            battleside = this.state.p1;
        } else {
            battleside = this.state.p2;
        }

        var pokemon = this.getPokemon(battleside, pokeName);
        if(!pokemon) {
            logger.error("We have never seen " + pokeName + " before in this battle. Should not have happened.");
            return;
        }

        //update hp
        pokemon.hp = Math.ceil(health / maxHealth * pokemon.maxhp);
        this.updatePokemon(battleside, pokemon);

    },
    updatePokemonOnBoost: function(tokens, isBoost) {
        var tokens2 = tokens[2].split(' ');
        var stat = tokens[3];
        var boostCount = parseInt(tokens[4]);
        var player = tokens2[0];
        var pokeName = tokens2[1];
        var battleside = undefined;

        if(this.isPlayer(player)) {
            battleside = this.state.p1;
        } else {
            battleside = this.state.p2;
        }

        var pokemon = this.getPokemon(battleside, pokeName);
        if(!pokemon) {
            logger.error("We have never seen " + pokeName + " before in this battle. Should not have happened.");
            return;
        }

        if(isBoost) {
            if(stat in pokemon.boosts)
                pokemon.boosts[stat] += boostCount;
            else
                pokemon.boosts[stat] = boostCount;
        } else {
            if(stat in pokemon.boosts)
                pokemon.boosts[stat] -= boostCount;
            else
                pokemon.boosts[stat] = -boostCount;
        }
        this.updatePokemon(battleside, pokemon);
    },
    updatePokemonSetBoost: function(tokens) {
        var tokens2 = tokens[2].split(' ');
        var stat = tokens[3];
        var boostCount = parseInt(tokens[4]);
        var player = tokens2[0];
        var pokeName = tokens2[1];
        var battleside = undefined;

        if(this.isPlayer(player)) {
            battleside = this.state.p1;
        } else {
            battleside = this.state.p2;
        }

        var pokemon = this.getPokemon(battleside, pokeName);
        if(!pokemon) {
            logger.error("We have never seen " + pokeName + " before in this battle. Should not have happened.");
            return;
        }

        pokemon.boosts[stat] = boostCount;
        this.updatePokemon(battleside, pokemon);
    },
    updatePokemonRestoreBoost: function(tokens) {
        var tokens2 = tokens[2].split(' ');
        var player = tokens2[0];
        var pokeName = tokens2[1];
        var battleside = undefined;

        if(this.isPlayer(player)) {
            battleside = this.state.p1;
        } else {
            battleside = this.state.p2;
        }

        var pokemon = this.getPokemon(battleside, pokeName);
        if(!pokemon) {
            logger.error("We have never seen " + pokeName + " before in this battle. Should not have happened.");
            return;
        }

        for(var stat in pokemon.boosts) {
            if(pokemon.boosts[stat] < 0)
                delete pokemon.boosts[stat];
        }
        this.updatePokemon(battleside, pokemon);


    },
    updatePokemonStart: function(tokens, newStatus) {
        //add condition such as leech seed, substitute, ability, confusion, encore
        //move: yawn, etc.
        //ability: flash fire, etc.

        var tokens2 = tokens[2].split(' ');
        var player = tokens2[0];
        var pokeName = tokens2[1];
        var status = tokens[3];
        var battleside = undefined;

        if(this.isPlayer(player)) {
            battleside = this.state.p1;
        } else {
            battleside = this.state.p2;
        }

        var pokemon = this.getPokemon(battleside, pokeName);

        if(status.substring(0,4) === 'move') {
            status = status.substring(6);
        } else if(status.substring(0,7) === 'ability') {
            status = status.substring(9);
        }

        if(newStatus) {
            pokemon.addVolatile(status);
        } else {
            pokemon.removeVolatile(status);
        }
        this.updatePokemon(battleside, pokemon);
    },
    updateField: function(tokens, newField) {
        //as far as I know, only applies to trick room, which is a pseudo-weather
        var fieldStatus = tokens[2].substring(6);
        if(newField) {
            this.state.addPseudoWeather(fieldStatus);
        } else {
            this.state.removePseudoWeather(fieldStatus);
        }
    },
    updateWeather: function(tokens) {
        var weather = tokens[2];
        if(weather === "none") {
            this.state.clearWeather();
        } else {
            this.state.setWeather(weather);
            //we might want to keep track of how long the weather has been lasting...
            //might be done automatically for us
        }
    },
    updateSideCondition: function(tokens, newSide) {
        var player = tokens[2].split(' ')[0];
        var sideStatus = tokens[3];
        if(sideStatus.substring(0,4) === "move")
            sideStatus = tokens[3].substring(6);
        var battleside = undefined;
        if(this.isPlayer(player)) {
            battleside = this.state.p1;
        } else {
            battleside = this.state.p2;
        }

        if(newSide) {
            battleside.addSideCondition(sideStatus);
            //Note: can have multiple layers of toxic spikes or spikes
        } else {
            battleside.removeSideCondition(sideStatus);
            //remove side status
        }
    },
    updatePokemonStatus: function(tokens, newStatus) {
        var tokens2 = tokens[2].split(' ');
        var player = tokens2[0];
        var pokeName = tokens2[1];
        var status = tokens[3];
        var battleside = undefined;

        if(this.isPlayer(player)) {
            battleside = this.state.p1;
        } else {
            battleside = this.state.p2;
        }
        var pokemon = this.getPokemon(battleside, pokeName);

        if(newStatus) {
            pokemon.setStatus(status);
            //record a new Pokemon's status
            //also keep track of how long the status has been going? relevant for toxic poison
            //actually, might be done by default
        } else {
            pokemon.clearStatus();
            //heal a Pokemon's status
        }
        this.updatePokemon(battleside, pokemon);
    },
    updatePokemonOnItem: function(tokens, newItem) {
        //record that a pokemon has an item. Most relevant if a Pokemon has an air balloon/chesto berry
        //TODO: try to predict the opponent's current item

        var tokens2 = tokens[2].split(' ');
        var player = tokens2[0];
        var pokeName = tokens2[1];
        var item = tokens[3];
        var battleside = undefined;

        if(this.isPlayer(player)) {
            battleside = this.state.p1;
        } else {
            battleside = this.state.p2;
        }
        var pokemon = this.getPokemon(battleside, pokeName);

        if(newItem) {
            pokemon.setItem(item);
        } else {
            pokemon.clearItem(item);
        }
        this.updatePokemon(battleside, pokemon);
    },

    //Apply mega evolution effects, or aegislash/meloetta
    updatePokemonOnFormeChange: function(tokens) {
        var tokens2 = tokens[2].split(' ');
        var tokens3 = tokens[3].split(', ');
        var player = tokens2[0];
        var pokeName = tokens2[1];
        var newPokeName = tokens3[0];
        var battleside = undefined;

        if(this.isPlayer(player)) {
            battleside = this.state.p1;
        } else {
            battleside = this.state.p2;
        }
        //Note: crashes when the bot mega evolves.
        logger.info(pokeName + " has transformed into " + newPokeName + "!");
        var pokemon = this.getPokemon(battleside, pokeName, true);

        //apply forme change
        pokemon.formeChange(newPokeName);
        this.updatePokemon(battleside, pokemon);
    },
    //for ditto exclusively
    updatePokemonOnTransform: function(tokens) {
        var tokens2 = tokens[2].split(' ');
        var tokens3 = tokens[3].split(' ');
        var player = tokens2[0];
        var pokeName = tokens2[1];
        var newPokeName = tokens3[1];
        var battleside = undefined;
        var pokemon = undefined;

        if(this.isPlayer(player)) {
            battleside = this.state.p1;
            pokemon = this.getPokemon(battleside, pokeName);
            pokemon.transformInto(this.state.p2.active[0]);
        } else {
            battleside = this.state.p2;
            pokemon = this.getPokemon(battleside, pokeName);
            pokemon.transformInto(this.state.p1.active[0]);
        }
        this.updatePokemon(battleside, pokemon);

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
                } else if (tokens[1] === 'win') {
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

                } else if (tokens[1] === 'switch' || tokens[1] === 'drag') {
                    this.updatePokemonOnSwitch(tokens);
                } else if(tokens[1] === 'faint') { //we could outright remove a pokemon...
                    //record that pokemon has fainted
                } else if(tokens[1] === 'detailschange' || tokens[1] === 'formechange') {
                    this.updatePokemonOnFormeChange(tokens);
                } else if(tokens[1] === '-transform') {
                    this.updatePokemonOnTransform(tokens);
                } else if(tokens[1] === '-damage') { //Error: not getting to here...
                    this.updatePokemonOnDamage(tokens);
                } else if(tokens[1] === '-heal') {
                    this.updatePokemonOnDamage(tokens);
                } else if(tokens[1] === '-boost') {
                    this.updatePokemonOnBoost(tokens, true);
                } else if(tokens[1] === '-unboost') {
                    this.updatePokemonOnBoost(tokens, false);
                } else if(tokens[1] === '-setboost') {
                    this.updatePokemonSetBoost(tokens);
                } else if(tokens[1] === '-restoreboost') {
                    this.updatePokemonRestoreBoost(tokens);
                } else if(tokens[1] === '-start') {
                    this.updatePokemonStart(tokens, true);
                } else if(tokens[1] === '-end') {
                    this.updatePokemonStart(tokens, false);
                } else if(tokens[1] === '-fieldstart') {
                    this.updateField(tokens, true);
                } else if(tokens[1] === '-fieldend') {
                    this.updateField(tokens, true);
                } else if(tokens[1] === '-weather') {
                    this.updateWeather(tokens);
                } else if(tokens[1] === '-sidestart') {
                    this.updateSideCondition(tokens, true);
                } else if(tokens[1] === '-sideend') {
                    this.updateSideCondition(tokens, false);
                } else if(tokens[1] === '-status') {
                    this.updatePokemonStatus(tokens, true);
                } else if(tokens[1] === '-curestatus') {
                    this.updatePokemonStatus(tokens, false);
                } else if(tokens[1] === '-item') {
                    this.updatePokemonOnItem(tokens, true);
                } else if(tokens[1] === '-enditem') {
                    this.updatePokemonOnItem(tokens, false);
                } else if(tokens[1] === '-ability') {
                    //relatively situational -- important for mold breaker/teravolt, etc.
                    //needs to be recorded so that we don't accidentally lose a pokemon

                    //We don't actually care about the rest of these effects, as they are merely visual
                } else if (tokens[1] === 'move') {
                    //we actually don't need to record anything -- moves are mostly dealt for us
                } else if(tokens[1] === '-supereffective') {

                } else if(tokens[1] === '-crit') {

                } else if(tokens[1] === '-singleturn') { //for protect. But we only care about damage...

                } else if(tokens[1] === 'c') {//chat message. ignore. (or should we?)

                } else if(tokens[1] === '-activate') { //protect, wonder guard, etc.

                } else if(tokens[1] === '-fail') {

                } else if(tokens[1] === '-immune') {

                } else if(tokens[1] === 'message') {

                } else if(tokens[1] === 'cant') {

                } else if(tokens[1] === 'leave') {

                } else if(tokens[1]) { //what if token is defined
                    logger.info("Error: could not parse token '" + tokens[1] + "'. This needs to be implemented");
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
        };
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
    //is this redundant?
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
                item: (!pokemon.item || pokemon.item === '') ? '' : Items[pokemon.item].name,
                level: level,
                active: pokemon.active,
                shiny: false
            };

            //keep track of old pokemon
            var oldPokemon = this.state.p1.pokemon[i];

            // Initialize pokemon
            this.state.p1.pokemon[i] = new BattlePokemon(template, this.state.p1);
            this.state.p1.pokemon[i].position = i;

            // Update the pokemon object with latest stats
            for (var stat in pokemon.stats) {
                this.state.p1.pokemon[i].baseStats[stat] = pokemon.stats[stat];
            }
            // Update health/status effects, if any
            var condition = pokemon.condition.split(/\/| /);
            this.state.p1.pokemon[i].hp = parseInt(condition[0]);
            if(condition.length > 2) {//add status condition
                this.state.p1.pokemon[i].setStatus(condition[2]); //necessary?
            }

            // Keep old boosts
            this.state.p1.pokemon[i].boosts = oldPokemon.boosts;

            // Keep old volatiles
            this.state.p1.pokemon[i].volatiles = oldPokemon.volatiles;

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
            room.send("/choose " + BattleRoom.toChoiceString(result, room.state.p1) + "|" + decision.rqid, room.id);
        }, 2000);
    },
    // Static class methods
    extend: {
        toChoiceString: function(choice, battleside) {
            if (choice.type == "move") {
                if(battleside && battleside.active[0].canMegaEvo) //mega evolve if possible
                    return "move " + choice.id + " mega";
                else
                    return "move " + choice.id;
            } else if (choice.type == "switch") {
                return "switch " + (choice.id + 1);
            }
        },
        parseRequest: function(request) {
            var choices = [];

            if(!request) return choices; // Empty request
            if(request.wait) return choices; // This player is not supposed to make a move

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
