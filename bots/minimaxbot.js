// Logging
var log4js = require('log4js');
var logger = require('log4js').getLogger("minimax");
log4js.addAppender(log4js.appenders.file('logs/minimax.log'), 'minimax');
var learnlog = require('log4js').getLogger("learning");
log4js.addAppender(log4js.appenders.file('logs/learning.log'), 'learning');

var program = require('commander'); // Program settings
var fs = require('fs');

var _ = require("underscore");
var BattleRoom = require("./../battleroom");

var randombot = require("./randombot");
var greedybot = require("./greedybot");

var clone = require("./../clone");

var convnetjs = require("convnetjs");

// Extract a feature vector from the hash. This is to maintain a specific order
var BATTLE_FEATURES = ["items", "faster", "has_supereffective", "has_stab"];
var SIDE_CONDITIONS = ["reflect", "spikes", "stealthrock", "stickyweb", "toxicspikes", "lightscreen", "tailwind"];
var VOLATILES = ["substitute", 'confusion', 'leechseed', 'infestation'];
var STATUSES = ["psn", "tox", "slp", "brn", "frz", "par"];
var BOOSTS = ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'];

_.each(SIDE_CONDITIONS, function(condition) {
    BATTLE_FEATURES.push("p1_" + condition);
    BATTLE_FEATURES.push("p2_" + condition);
});

_.each(VOLATILES, function(volatile) {
    BATTLE_FEATURES.push("p1_" + volatile);
    BATTLE_FEATURES.push("p2_" + volatile);
});

_.each(BOOSTS, function(boost) {
    BATTLE_FEATURES.push("p1_" + boost);
    BATTLE_FEATURES.push("p2_" + boost);
});

_.each(STATUSES, function(status) {
    BATTLE_FEATURES.push("p1_" + status + "_count");
    BATTLE_FEATURES.push("p2_" + status + "_count");
});

BATTLE_FEATURES.push("p1_hp");
BATTLE_FEATURES.push("p2_hp");

module.exports.BATTLE_FEATURES = BATTLE_FEATURES;

function featureVector(battle) {
    var features = getFeatures(battle);
    var vec = _.map(BATTLE_FEATURES, function(feature) {
       return features[feature];
    });
    return new convnetjs.Vol(vec);
}


// Initialize neural network
var net = undefined;
var trainer = undefined;
if(program.net === "create") {
    learnlog.info("Creating neural network...");

    // Multi-layer neural network
    var layer_defs = [];
    layer_defs.push({type: 'input', out_sx: 1, out_sy: 1, out_depth: BATTLE_FEATURES.length});
    layer_defs.push({type:'fc', num_neurons:10, activation:'relu'});
    layer_defs.push({type:'fc', num_neurons:10, activation:'sigmoid'});
    layer_defs.push({type: 'regression', num_neurons: 1});

    net = new convnetjs.Net();
    net.makeLayers(layer_defs);

    _.each(net.layers, function(layer) {
        if(layer.filters) {
            _.each(layer.filters, function(filter) {
                if(filter.w) {
                    var num = filter.w.byteLength / filter.w.BYTES_PER_ELEMENT;
                    for(var i = 0; i < num; ++i) filter.w.set([0.0], i);
                }
            });
        }
    });

    fs.writeFileSync("network.json", JSON.stringify(net.toJSON()));
    program.net = "update"; // Now that the network is created, it should also be updated
    learnlog.info("Created neural network...");
} else if(program.net === "use" || program.net === "update") {
    learnlog.info("Loading neural network...");
    net = new convnetjs.Net();
    net.fromJSON(JSON.parse(fs.readFileSync("network.json", "utf8")));
}
module.exports.net = net;

// If we need to be able to update the network, create a trainer object
if(program.net === "update") {
    trainer = new convnetjs.Trainer(net, {method: 'adadelta', l2_decay: 0.001,
        batch_size: 1});
    learnlog.trace("Created SGD Trainer");
}

// Train the network on a battle, newbattle
// If this is a reward state, set newbattle to null, and win to whether or not the bot won
var train_net = module.exports.train_net = function(battle, newbattle, win) {
    learnlog.info("Training neural network...");

    var value = undefined;

    if (newbattle == null) {
        value = win ? GAME_END_REWARD : -GAME_END_REWARD;

        // Apply discount
        value *= DISCOUNT;
    }
    else {
        value = DISCOUNT * eval(newbattle);

        var isAlive = function(pokemon) { return pokemon.hp > 0; };
        var opponentDied = _.filter(battle.p2.pokemon, isAlive).length - _.filter(newbattle.p2.pokemon, isAlive).length;
        var playerDied = _.filter(battle.p1.pokemon, isAlive).length - _.filter(newbattle.p1.pokemon, isAlive).length;
        value += opponentDied * 10;
        value -= playerDied * 10;

        if(opponentDied > 0) learnlog.info("Rewarded for killing an opponent pokemon.");
        if(playerDied > 0) learnlog.info("Negative rewarded for losing a pokemon.");
    }



    var vec = featureVector(battle);
    trainer.train(vec, [value]);

    fs.writeFileSync("network.json", JSON.stringify(net.toJSON(), undefined, 2));
}

//TODO: Features should not take into account Unown pokemon. (Doesn't really matter now, but it will...)
function getFeatures(battle) {
    var features = {};

    // Side conditions
    _.each(SIDE_CONDITIONS, function(condition) {
        features["p1_" + condition] = (condition in battle.p1.sideConditions) ? 1 : 0;
        features["p2_" + condition] = (condition in battle.p2.sideConditions) ? 1 : 0;
    });

    // Volatile statuses on current pokemon
    _.each(VOLATILES, function(volatile) {
        features["p1_" + volatile] = (volatile in battle.p1.active[0].volatiles ? 1 : 0);
        features["p2_" + volatile] = (volatile in battle.p2.active[0].volatiles ? 1 : 0);
    });

    // Boosts on pokemon
    _.each(BOOSTS, function(boost) {
        features["p1_" + boost] = battle.p1.active[0].boosts[boost];
        features["p2_" + boost] = battle.p2.active[0].boosts[boost];
    });

    //total hp
    //Note: as hp depletes to zero it becomes increasingly less important.
    //Pokemon with low hp have a higher chance of dying upon switching in
    //or dying due to a faster opponent. This is more important for slow
    //pokemon.
    //good to keep into consideration...
    features["p1_hp"] = 0;
    features["p2_hp"] = 0;

    //alive pokemon
    features["p1_alive"] = 0;
    features["p2_alive"] = 0;

    //status effects. TODO: some status effects are worse on some pokemon than others
    //paralyze: larger effects on fast, frail pokemon
    //burn: larger effects on physical attackers
    //toxic poison: larger effects on bulky attackers
    //sleep: bad for everyone
    //freeze: quite unfortunate.
    _.each(STATUSES, function(status) {
        features["p1_" + status + "_count"] = 0;
        features["p2_" + status + "_count"] = 0;
    });

    // Per pokemon features
    for(var i = 0; i < 6; ++i) {
        features["p1_hp"] += (battle.p1.pokemon[i].hp ? battle.p1.pokemon[i].hp : 0) / battle.p1.pokemon[i].maxhp;
        features["p2_hp"] += (battle.p2.pokemon[i].hp ? battle.p2.pokemon[i].hp : 0) / battle.p2.pokemon[i].maxhp;

        if(battle.p1.pokemon[i].hp) ++features["p1_alive"];
        if(battle.p2.pokemon[i].hp) ++features["p2_alive"];

        if(_.contains(STATUSES, battle.p1.pokemon[i].status)) ++features["p1_" + battle.p1.pokemon[i].status + "_count"];
        if(_.contains(STATUSES, battle.p2.pokemon[i].status)) ++features["p2_" + battle.p2.pokemon[i].status + "_count"];
    }

    // Cap sleep count at 1, due to Sleep Cause mod
    features["p1_slp_count"] = Math.min(features["p1_slp_count"], 1);
    features["p2_slp_count"] = Math.min(features["p2_slp_count"], 1);

    //items: prefer to have items rather than lose them (such as berries, focus sash, ...)
    features.items = _.reduce(battle.p1.pokemon, function (memo, pokemon) {
        return memo + (pokemon.item && pokemon.hp ? 1 : 0);
    }, 0);

    //the current matchup. Dependent on several factors:
    //-speed comparison. generally want higher speed (unless we're bulky, in which case that's fine)
    features.faster = (battle.p1.active[0].speed > battle.p2.active[0].speed) ? 1 : 0;

    //-damage potential. Use greedybot to determine if there are good moves that we have in this state
    var choices = BattleRoom.parseRequest(battle.p1.request).choices;
    var priorities = _.map(choices, function(choice) {
        return greedybot.getPriority(battle, choice, battle.p1, battle.p2);
    });

    features["has_supereffective"] = (_.contains(priorities, 7) || _.contains(priorities, 8)) ? 1 : 0;
    features["has_stab"] = (_.contains(priorities, 6) || _.contains(priorities, 8)) ? 1 : 0;

    //overall pokemon variety. Overall we want a diverse set of pokemon.
    //-types: want a variety of types to be good defensively vs. opponents
    //-moves: want a vareity of types to be good offensively vs. opponents
    //-stat spreads: we don't really want all physical or all special attackers.
    //     also, our pokemon should be able to fulfill different roles, so we want
    //     to keep a tanky pokemon around or a wall-breaker around

    return features;
}

var weights = require("./../weights.js");

//TODO: Eval function needs to be made 1000x better
function eval(battle) {
    var value = 0;
    var features = getFeatures(battle);

    if(program.net === "none") {
        for (var key in weights) {
            if(key in features) value += weights[key] * features[key];
        }
    } else if (program.net === "update" || program.net === "use") {
        var vec = featureVector(battle);
        value = net.forward(vec).w[0];
    }

    logger.trace(JSON.stringify(features) + ": " + value);
    return value;
}

var overallMinNode = {};
var decide = module.exports.decide = function(battle, choices) {
    battle.start();

    var MAX_DEPTH = 2; //for now...
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

var GAME_END_REWARD = module.exports.GAME_END_REWARD = 1000000;
var DISCOUNT = module.exports.DISCOUNT = 0.98;

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
	};

	// Look for win / loss
	var playerAlive = _.any(battle.p1.pokemon, function(pokemon) { return pokemon.hp > 0; });
	var opponentAlive = _.any(battle.p2.pokemon, function(pokemon) { return pokemon.hp > 0; });
	if (!playerAlive || !opponentAlive) {
		node.value = playerAlive ? GAME_END_REWARD : -GAME_END_REWARD;
		return node;
	}

	if(depth == 0) {
		node.value = eval(battle);
        node.state += "\n" + JSON.stringify(getFeatures(battle), undefined, 2);
	} else {
		// If the request is a wait request, the opposing player has to take a turn, and we don't
		if(battle.p1.request.wait) {
			return opponentTurn(battle, depth, alpha, beta, null);
		}
		var choices = (givenchoices) ? givenchoices : BattleRoom.parseRequest(battle.p1.request).choices;
            //sort choices
            choices = _.sortBy(choices, function(choice) {
                var priority = greedybot.getPriority(battle, choice, battle.p1, battle.p2);
                choice.priority = priority;
                return -priority;
            });
            for(var i = 0; i < choices.length; i++) {
                logger.info(choices[i].id + " with priority " + choices[i].priority);
            }
	        //choices = _.sample(choices, 1); // For testing
                //TODO: before looping through moves, move choices from array to priority queue to give certain moves higher priority than others
                //Essentially, the greedy algorithm
                //Perhaps then we can increase the depth...

		for(var i = 0; i < choices.length; ++i) {
		    // Try action
		    var minNode = opponentTurn(battle, depth, alpha, beta, choices[i]);
		    node.children.push(minNode);

		    if(minNode.value != null && isFinite(minNode.value) ) {
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

	// If the request is a wait request, only the player chooses an action
	if(battle.p2.request.wait) {
		var newbattle = clone(battle);
		newbattle.p2.decision = true;
		newbattle.choose('p1', BattleRoom.toChoiceString(playerAction, newbattle.p1), newbattle.rqid);
		return playerTurn(newbattle, depth - 1, alpha, beta);
	}

	var choices = BattleRoom.parseRequest(battle.p2.request).choices;

	// Make sure we can't switch to an unown or to a fainted pokemon
	choices = _.reject(choices, function(choice) {
		if(choice.type == "switch" &&
                   (battle.p2.pokemon[choice.id].name == "Unown" ||
                    !battle.p2.pokemon[choice.id].hp)) return true;
		return false;
	});

	// We don't have enough info to simulate the battle anymore
	if(choices.length == 0) {
		node.value = eval(battle);
        node.state += "\n" + JSON.stringify(getFeatures(battle), undefined, 2);
		return node;
	}

    //sort choices
    choices = _.sortBy(choices, function(choice) {
        var priority = greedybot.getPriority(battle, choice, battle.p2, battle.p1);
        choice.priority = priority;
        return -priority;
    });
    for(var i = 0; i < choices.length; i++) {
        logger.info(choices[i].id + " with priority " + choices[i].priority);
    }

    // Take top 10 choices, to limit breadth of tree
    choices = _.take(choices, 10);

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

		if(maxNode.value != null && isFinite(maxNode.value)) {
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
