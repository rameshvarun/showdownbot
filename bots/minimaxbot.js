// Logging
var log4js = require('log4js');
var logger = require('log4js').getLogger("minimax");
log4js.addAppender(log4js.appenders.file('logs/minimax.log'), 'minimax');

var _ = require("underscore");
var BattleRoom = require("./../battleroom");

var randombot = require("./randombot");

var clone = require("./../clone");

//TODO: Features should not take into account Unown pokemon. (Doesn't really matter now, but it will...)
function getFeatures(battle) {
    var features = {};

    //total hp
    //Note: as hp depletes to zero it becomes increasingly less important.
    //Pokemon with low hp have a higher chance of dying upon switching in
    //or dying due to a faster opponent. This is more important for slow
    //pokemon.
    //good to keep into consideration...
    features.mySum = _.reduce(battle.p1.pokemon, function(memo, pokemon){
        return memo + pokemon.hp / pokemon.maxhp;
    }, 0);
    features.theirSum = _.reduce(battle.p2.pokemon, function(memo, pokemon){
        return memo + pokemon.hp / pokemon.maxhp;
    }, 0);

    //status effects. TODO: some status effects are worse on some pokemon than others
    //paralyze: larger effects on fast, frail pokemon
    //burn: larger effects on physical attackers
    //toxic poison: larger effects on bulky attackers
    //sleep: bad for everyone
    //freeze: quite unfortunate.

    //hazards and reflect/light screen/tailwind
    //For hazards in particular, they're not as useful towards the end of the match...

    //leech seed/infestation

    //stat boosts

    //substitute/etc.

    //the current matchup. Dependent on several factors:
    //-speed comparison. generally want higher speed (unless we're bulky, in which case that's fine)
    //-damage potential. ideally we want to deal more damage to opponent than vice versa
    //if we can kill the opponent right now then maybe that's something we should do
    //instead of letting the opponent set up/get killed ourselves.

    //overall pokemon variety. Overall we want a diverse set of pokemon.
    //-types: want a variety of types to be good defensively vs. opponents
    //-moves: want a vareity of types to be good offensively vs. opponents
    //-stat spreads: we don't really want all physical or all special attackers.
    //     also, our pokemon should be able to fulfill different roles, so we want
    //     to keep a tanky pokemon around or a wall-breaker around

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
    battle.start();

    var MAX_DEPTH = 1; //for now...
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

	// Look for win / loss

	if(depth == 0) {
		node.value = eval(battle);
	} else {
		// If the request is a wait request, the opposing player has to take a turn. Don't decrement depth.
		if(battle.p1.request.wait) {
			return opponentTurn(battle, depth, alpha, beta, null);
		}

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

	// If the request is a wait request, only the player chooses an action. Don't decrement depth
	if(battle.p2.request.wait) {
		var newbattle = clone(battle);
		newbattle.p2.decision = true;
		newbattle.choose('p1', BattleRoom.toChoiceString(playerAction, newbattle.p1), newbattle.rqid);
		return playerTurn(newbattle, depth, alpha, beta);
	}

	var choices = BattleRoom.parseRequest(battle.p2.request).choices;

	// Make sure we can't switch to an unown
	choices = _.reject(choices, function(choice) {
		if(choice.type == "switch" && battle.p2.pokemon[choice.id].name == "Unown") return true;
		return false;
	});

	// We don't have enough info to simulate the battle anymore
	if(choices.length == 0) {
		node.value = eval(battle);
		return node;
	}

	for(var i = 0; i < choices.length; ++i) {
		logger.trace("Cloning battle...");
		var newbattle = clone(battle);

		// Register action, let battle simulate
		if(playerAction)
			newbattle.choose('p1', BattleRoom.toChoiceString(playerAction, newbattle.p1), newbattle.rqid);
		else
			newbattle.p1.decision = true;
		newbattle.choose('p2', BattleRoom.toChoiceString(choices[i], newbattle.p2), newbattle.rqid);
                logger.info("Player action: " + BattleRoom.toChoiceString(playerAction, newbattle.p1));
                logger.info("Opponent action: " + BattleRoom.toChoiceString(choices[i], newbattle.p2));
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

		// Hopefully prompt garbage collection, so we don't maintain too many battle object
		delete newbattle;
		if(global.gc) global.gc()
	}

	node.choices = choices;
	return node;
}
