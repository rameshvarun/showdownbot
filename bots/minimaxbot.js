// Logging
var log4js = require('log4js');
var logger = require('log4js').getLogger("minimax");
log4js.addAppender(log4js.appenders.file('logs/minimax.log'), 'minimax');

var _ = require("underscore");
var BattleRoom = require("./../battleroom");

var randombot = require("./randombot");

function getFeatures(battle) {
	features = {};

	features.mySum = _.reduce(battle.p1.pokemon, function(memo, pokemon){ return memo + pokemon.hp; }, 0);
	features.theirSum = _.reduce(battle.p2.pokemon, function(memo, pokemon){ return memo + pokemon.hp; }, 0);

	return features;
}

function eval(battle) {
	var features = getFeatures(battle);
	var value = features.mySum - features.theirSum;
	logger.trace(JSON.stringify(features) + ": " + value);
	return value;
}

var decide = module.exports.decide = function(battle, choices) {
	var MAX_DEPTH = 2;
	var maxNode = playerTurn(battle, MAX_DEPTH, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, choices);
	if(!maxNode.action) randombot.decide(battle, choices);
	return {
		type: maxNode.action.type,
		id: maxNode.action.id,
		tree: maxNode
	};
}

function playerTurn(battle, depth, alpha, beta, givenchoices) {
	logger.trace("Player turn at depth " + depth);

	// Node in the minimax tree
	var node = {
		type : "max",
		value : Number.NEGATIVE_INFINITY,
		depth : depth,
		choices : [],
		children : [],
		action : null,
		state : battle.toString()
	}

	if(depth == 0) {
		node.value = eval(battle);
	} else {
		var choices = (givenchoices) ? givenchoices : BattleRoom.parseRequest(battle.p1.request).choices;
		//choices = _.sample(choices, 1); // For testing

		for(var i = 0; i < choices.length; ++i) {
			// Try action
			var minNode = opponentTurn(battle, depth, alpha, beta, choices[i]);
			node.children.push(minNode);

			if(minNode.value != null) {
				if(minNode.value > node.value) {
					node.value = minNode.value;
					node.action = choices[i];
				}
				alpha = Math.max(alpha, minNode.value);
				if(beta <= alpha) break;
			}
		}

		node.choices = choices;
	}

	return node;
}

function opponentTurn(battle, depth, alpha, beta, playerAction) {
	logger.trace("Opponent turn turn at depth " + depth);

	// Node in the minimax tree
	var node = {
		type : "min",
		value : Number.POSITIVE_INFINITY,
		depth : depth,
		choices : [],
		children : [],
		action : null,
		state: battle.toString()
	}

	var choices = BattleRoom.parseRequest(battle.p2.request).choices;

	// Make sure we can't switch to an unown
	choices = _.reject(choices, function(choice) {
		if(choice.type == "switch" && battle.p2.pokemon[choice.id].name == "Unown") return true;
		return false;
	});

	for(var i = 0; i < choices.length; ++i) {
		logger.trace("Cloning battle...");
		var newbattle = battle.clone();

		// Register action, let battle simulate
		newbattle.choose('p1', BattleRoom.toChoiceString(playerAction), newbattle.rqid)
		newbattle.choose('p2', BattleRoom.toChoiceString(choices[i]), newbattle.rqid)

		var maxNode = playerTurn(newbattle, depth - 1, alpha, beta);
		node.children.push(maxNode);

		if(maxNode.value != null) {
			if(maxNode.value < node.value) {
				node.value = maxNode.value;
				node.action = choices[i];
			}
			beta = Math.min(beta, maxNode.value);
			if(beta <= alpha) break;
		}
	}

	node.choices = choices;
	return node;
}