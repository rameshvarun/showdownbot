// Logging
var log4js = require('log4js');
var logger = require('log4js').getLogger("minimax");
log4js.addAppender(log4js.appenders.file('logs/minimax.log'), 'minimax');

require('sugar')

var _ = require("underscore");
var clone = require("clone");

var toChoiceString = module.exports.toChoiceString = function (choice) {
    if(choice.type == "move") {
        return "move " + choice.id;
    } else if(choice.type == "switch") {
        return "switch " + (choice.id + 1);
    }
}

function getFeatures(battle) {
	features = {};

	var currentPokemon = battle.p1.active[0];
	features.currentPokemonHP = currentPokemon.hp;

	var oppPokemon = battle.p2.active[0];
	features.oppPokemonHP = oppPokemon.hp;

	return features;
}

function eval(battle) {
	var features = getFeatures(battle);
	var value = features.currentPokemonHP - features.oppPokemonHP;
	logger.trace(JSON.stringify(features) + ": " + value);
	return value;
}

var decide = module.exports.decide = function(battle, choices) {
	var MAX_DEPTH = 1;
	return playerTurn(battle, MAX_DEPTH, choices);
}


function playerTurn(battle, depth, givenchoices) {
	logger.trace("Player turn at depth " + depth);

	if(depth == 0) return eval(battle);

	var max_value = Number.NEGATIVE_INFINITY;
	var max_action = null;

	var choices = undefined;
	if(givenchoices) choices = givenchoices;
	else {
		// TODO: Find choices
		choices = [];
	}

	for(var i = 0; i < choices.length; ++i) {
		logger.trace("Cloning battle...");
		var newbattle = clone(battle, true);

		// Register action
		newbattle.choose('p1', toChoiceString(choices[i]), newbattle.rqid)
		var value = opponentTurn(newbattle, depth);
		if(value > max_value) {
			max_value = value;
			max_action = choices[i];
		}
	}

	if(givenchoices) return max_action;
	else return max_value;
}

function opponentTurn(battle, depth) {
	logger.trace("Opponent turn turn at depth " + depth);

	var min_value = Number.POSITIVE_INFINITY;
	var min_action = null;

	var choices = [];
	var pokemon = battle.p2.active[0];
	_.each(pokemon.getMoves(), function(move) {
		choices.push({
			"type" : "move",
			"id" : move.id
		});
	});

	// TODO: Find switching options

	for(var i = 0; i < choices.length; ++i) {
		logger.trace("Cloning battle...");
		var newbattle = clone(battle, true);

		// Register action
		newbattle.choose('p2', toChoiceString(choices[i]), newbattle.rqid)
		var value = playerTurn(newbattle, depth - 1);

		if(value < min_value) {
			min_value = value;
			min_action = choices[i];
		}
	}

	return min_value;
}