// Logging
var log4js = require('log4js');
var logger = require('log4js').getLogger("minimax");
log4js.addAppender(log4js.appenders.file('logs/minimax.log'), 'minimax');

var _ = require("underscore");
var BattleRoom = require("./../battleroom");

var randombot = require("./randombot");

var clone = require("clone");

//TODO: Features should not take into account Unown pokemon. (Doesn't really matter now, but it will...)
function getFeatures(battle) {
	features = {};

	features.mySum = _.reduce(battle.p1.pokemon, function(memo, pokemon){
            return memo + pokemon.hp / pokemon.maxhp;
        }, 0);
	features.theirSum = _.reduce(battle.p2.pokemon, function(memo, pokemon){
            return memo + pokemon.hp / pokemon.maxhp;
        }, 0);

	return features;
}

//TODO: Eval function needs to be made 1000x better
function eval(battle) {
	var features = getFeatures(battle);
	var value = features.mySum - features.theirSum;
	logger.trace(JSON.stringify(features) + ": " + value);
	return value;
}

var overallMinNode = {};
var decide = module.exports.decide = function(battle, choices) {
<<<<<<< HEAD

	var MAX_DEPTH = 2;
	var maxNode = playerTurn(battle, MAX_DEPTH, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, choices);
	if(!maxNode.action) return randombot.decide(battle, choices);
        logger.info("My action: " + maxNode.action.type + " " + maxNode.action.id);
        if(overallMinNode.action) logger.info("Predicted opponent action: " + overallMinNode.action.type + " " + overallMinNode.action.id);
	return {
		type: maxNode.action.type,
		id: maxNode.action.id,
		tree: maxNode
	};
=======
    var MAX_DEPTH = 2;
    var maxNode = playerTurn(battle, MAX_DEPTH, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, choices);
    if(!maxNode.action) return randombot.decide(battle, choices);
    logger.info("My action: " + maxNode.action.type + " " + maxNode.action.id);
    if(overallMinNode.action)
        logger.info("Predicted opponent action: " + overallMinNode.action.type + " " + overallMinNode.action.id);
    return {
	type: maxNode.action.type,
	id: maxNode.action.id,
	tree: maxNode
    };
>>>>>>> 4a1e1538c2efbbb67d27be309c6b9994e181841b
}

//TODO: Implement move ordering, which can be based on the original greedy algorithm
//However, it should have slightly different priorities, such as status effects...
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
                //TODO: before looping through moves, move choices from array to priority queue to give certain moves higher priority than others
                //Essentially, the greedy algorithm
                //Perhaps then we can increase the depth...

		for(var i = 0; i < choices.length; ++i) {
			// Try action
			var minNode = opponentTurn(battle, depth, alpha, beta, choices[i]);
			node.children.push(minNode);

			if(minNode.value != null) {
				if(minNode.value > node.value) {
					node.value = minNode.value;
					node.action = choices[i];
                                        overallMinNode = minNode;
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
		var newbattle = clone(battle); //it appears that the clone is still failing to completely replicate state

		// Register action, let battle simulate
		newbattle.choose('p1', BattleRoom.toChoiceString(playerAction), newbattle.rqid);
		newbattle.choose('p2', BattleRoom.toChoiceString(choices[i]), newbattle.rqid);
                logger.info("Player action: " + BattleRoom.toChoiceString(playerAction));
                logger.info("Opponent action: " + BattleRoom.toChoiceString(choices[i]));
                logger.info("My Resulting Health:");
                for(var j = 0; j < newbattle.p1.pokemon.length; j++) {
                    logger.info(newbattle.p1.pokemon[j].id + ": " + newbattle.p1.pokemon[j].hp + "/" + newbattle.p1.pokemon[j].maxhp);
                }
                logger.info("Opponent's Resulting Health:");
                for(var j = 0; j < newbattle.p2.pokemon.length; j++) {
                    logger.info(newbattle.p2.pokemon[j].id + ": " + newbattle.p2.pokemon[j].hp + "/" + newbattle.p2.pokemon[j].maxhp);
                }
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
