//Logging
var log4js = require('log4js');
var logger = log4js.getLogger("greedy");

var _ = require("underscore");
var BattleRoom = require("./../battleroom");

var randombot = require("./randombot");

var Tools = require("./../tools");
var damagingMoves = ["return", "grassknot", "lowkick", "gyroball", "heavyslam"];

var switchPriority = module.exports.switchPriority = function(battle, pokemon, p1, p2) {
    var oppPokemon = p2.active[0];
    var myPokemon = p1.pokemon[pokemon.id];
    //Incoming poke is immune to both of opponent Pokemon's types: 5
    if(_.all(oppPokemon.getTypes(), function(type) {
        return !Tools.getImmunity(type, myPokemon.getTypes());
    })) {
        return 5;
    }
    //Incoming poke resists both of opponents' types: 4
    if(_.all(oppPokemon.getTypes(), function(type) {
        return Tools.getEffectiveness(type, myPokemon) < 0 || !Tools.getImmunity(type, myPokemon.getTypes());
    })) {
        return 4;
    }
    //Incoming poke receives neutral damage from opponent: 3
    if(_.all(oppPokemon.getTypes(), function(type) {
        return Tools.getEffectiveness(type, myPokemon) <= 0 ||!Tools.getImmunity(type, myPokemon.getTypes());
    })) {
        return 3;
    }
    //Incoming poke can deal super effective damage to opponents' pokemon: 2
    if(_.any(myPokemon.getMoves(), function(move) {
        var moveData = Tools.getMove(move.id);
        return Tools.getEffectiveness(moveData, oppPokemon) > 0 &&
            (moveData.basePower > 0 || damagingMoves.indexOf(move.id) >= 0) &&
            Tools.getImmunity(moveData.type, oppPokemon.getTypes());
    })) {
        return 2;
    }

    //Otherwise, give 0 priority
    return 0;
};

var movePriority = module.exports.movePriority = function(battle, move, p1, p2) {
    var myPokemon = p1.active[0];
    var oppPokemon = p2.active[0];

    var moveData = Tools.getMove(move.id);

    //Light screen, reflect, or tailwind, and make sure they aren't already put up: 12
    var helpfulSideEffects = ["reflect","lightscreen","tailwind"];
    if(helpfulSideEffects.indexOf(move.id) >= 0 && !p1.getSideCondition(move.id)) {
        return 12;
    }

    //Entry hazard: stealth rock, spikes, toxic spikes, or sticky web: 11
    var entryHazards = ["stealthrock","spikes","toxicspikes","stickyweb"];
    if(entryHazards.indexOf(move.id) >= 0 && !p2.getSideCondition(move.id)) {
        return 11;
    }

    //Status effect: thunder wave, toxic, willowisp, glare, nuzzle: 10
    if(move.category === "Status" && move.status && !oppPokemon.status) {
        return 10;
    }

    //Recovery move: soft-boiled, recover, synthesis, moonlight, morning sun if hp is low enough: 9
    var recovery = ["softboiled", "recover", "synthesis", "moonlight", "morningsun"];
    if(recovery.indexOf(move.id) >= 0 && myPokemon.hp * 2 < myPokemon.maxhp) {
        return 9;
    }

    //Super effective move with STAB: 8
    if(Tools.getEffectiveness(moveData, oppPokemon) > 0 &&
       (moveData.basePower > 0 || damagingMoves.indexOf(move.id) >= 0) &&
       myPokemon.getTypes().indexOf(moveData.type) >= 0 &&
       Tools.getImmunity(moveData.type, oppPokemon.getTypes())) {
        return 8;
    }

    //Super effective move with no STAB: 7
    if(Tools.getEffectiveness(moveData, oppPokemon) > 0 &&
       (moveData.basePower > 0 || damagingMoves.indexOf(move.id) >= 0) &&
       Tools.getImmunity(moveData.type, oppPokemon.getTypes())) {
        return 7;
    }

    /*//If there is a super effective move, return 0 if there are good switches
    if(_.any(this.oppPokemon.getTypes(), function(oppType) {
        return Tools.getEffectiveness(oppType, myPokemon.getTypes()) > 0 &&
            Tools.getImmunity(oppType, myPokemon.getTypes());
    })) {
        return 0;
    }*/

    //Find move with STAB: 6
    if(Tools.getEffectiveness(moveData, oppPokemon) === 0 &&
       (moveData.basePower > 0 || damagingMoves.indexOf(move.id) >= 0) &&
       myPokemon.getTypes().indexOf(moveData.type) >= 0 &&
       Tools.getImmunity(moveData.type, oppPokemon.getTypes())) {
        return 6;
    }

    //Find normally effective move: 1
    if(Tools.getEffectiveness(moveData, oppPokemon) === 0 &&
       (moveData.basePower > 0 || damagingMoves.indexOf(move.id) >= 0) &&
       Tools.getImmunity(moveData.type, oppPokemon.getTypes())) {
        return 1;
    }

    //Otherwise, give 0 priority
    return 0;

};

var getPriority = module.exports.getPriority = function(battle, choice, p1, p2) {
    if(choice.type === "switch")
        return switchPriority(battle, choice, p1, p2);
    else
        return movePriority(battle, choice, p1, p2);
};

var decide = module.exports.decide = function(battle, choices, p1, p2) {
    if(!p1 || !p2) { //if not supplied, assume we are p1
        p1 = battle.p1;
        p2 = battle.p2;
    }

    var bestChoice = _.max(choices, function(choice) {
        var priority = getPriority(battle, choice, p1, p2);
        choice.priority = priority;
        return priority;
    });

    switch(bestChoice.priority) {
        case 12: logger.info("Chose " + bestChoice.id + " because it provides helpful side effects."); break;
        case 11: logger.info("Chose " + bestChoice.id + " because it is an entry hazard."); break;
        case 10: logger.info("Chose " + bestChoice.id + " because it causes a status effect."); break;
        case 9: logger.info("Chose " + bestChoice.id + " because it recovers hp."); break;
        case 8: logger.info("Chose " + bestChoice.id + " because it is super effective with STAB."); break;
        case 7: logger.info("Chose " + bestChoice.id + " because it is super effective."); break;
        case 6: logger.info("Chose " + bestChoice.id + " because it has STAB."); break;
        case 5: logger.info("Switched to " + p1.pokemon[bestChoice.id].name + " because it is immmune to the opponent's types."); break;
        case 4: logger.info("Switched to " + p1.pokemon[bestChoice.id].name + " because it resists the opponent's types."); break;
        case 3: logger.info("Switched to " + p1.pokemon[bestChoice.id].name + " because it recieves neutral damage from the opponent."); break;
        case 2: logger.info("Switched to " + p1.pokemon[bestChoice.id].name + " because it can deal super effective damage to the opponent."); break;
        case 1: logger.info("Chose " + bestChoice.id + " because it is normally effective."); break;
        case 0: logger.info("Chose " + bestChoice.id + " because we had no better option."); break;
        default: logger.error("Unknown priority.");
    }
    logger.info("Move has priority: " + bestChoice.priority);
    return {
        type: bestChoice.type,
        id: bestChoice.id,
        priority: bestChoice.priority
    };
};
