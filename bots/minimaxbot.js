// Logging
var log4js = require('log4js');
var logger = require('log4js').getLogger("minimax");
log4js.addAppender(log4js.appenders.file('logs/minimax.log'), 'minimax');

var program = require('commander'); // Program settings
var fs = require('fs');

var _ = require("underscore");
var BattleRoom = require("./../battleroom");

var randombot = require("./randombot");

var clone = require("./../clone");

var convnetjs = require("convnetjs");

// Initialize neural network
var net = undefined;
var trainer = undefined;
if(program.net === "create") {
    logger.info("Creating neural network...");
    var layer_defs = [];
    layer_defs.push({type: 'input', out_sx: 1, out_sy: 1, out_depth: 16});
    //layer_defs.push({type:'fc', num_neurons:20, activation:'relu'});
    //layer_defs.push({type:'fc', num_neurons:20, activation:'sigmoid'});
    layer_defs.push({type: 'regression', num_neurons: 1});
    net = new convnetjs.Net();
    net.makeLayers(layer_defs);

    fs.writeFileSync("network.json", JSON.stringify(net.toJSON()));
    program.net = "update"; // Now that the network is created, it should also be updated
} else if(program.net === "use" || program.net === "update") {
    logger.info("Loading neural network...");
    net = new convnetjs.Net();
    net.fromJSON(JSON.parse(fs.readFileSync("network.json", "utf8")));
}

// If we need to be able to update the network, create a trainer object
if(program.net === "update") trainer = new convnetjs.SGDTrainer(net, {learning_rate:0.01, momentum:0.0, batch_size:1, l2_decay:0.001});

// Train the network on a s r s' pair.
function train_net(battle, newbattle) {
    logger.info("Training neural network...");

    var value = undefined;

    // Is newbattle a win / loss
    var playerAlive = _.any(newbattle.p1.pokemon, function(pokemon) { return pokemon.hp > 0; });
    var opponentAlive = _.any(newbattle.p2.pokemon, function(pokemon) { return pokemon.hp > 0; });

    if (!playerAlive || !opponentAlive) value = playerAlive ? GAME_END_REWARD : -GAME_END_REWARD;
    else value = eval(newbattle);

    var vec = new convnetjs.Vol(_.values(getFeatures(battle)));
    trainer.train(vec, [value]);

    fs.writeFileSync("network.json", JSON.stringify(net.toJSON()));
}

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
        return memo + (pokemon.hp?pokemon.hp:0) / pokemon.maxhp;
    }, 0);
    features.theirSum = _.reduce(battle.p2.pokemon, function(memo, pokemon){
        return memo + (pokemon.hp?pokemon.hp:0) / pokemon.maxhp;
    }, 0);

    //alive pokemon
    features.myAlive = _.reduce(battle.p1.pokemon, function(memo, pokemon) {
        return memo + (pokemon.hp?1:0);
    }, 0);
    features.theirAlive = _.reduce(battle.p2.pokemon, function(memo, pokemon) {
        return memo + (pokemon.hp?1:0);
    }, 0);


    //status effects. TODO: some status effects are worse on some pokemon than others
    //paralyze: larger effects on fast, frail pokemon
    //burn: larger effects on physical attackers
    //toxic poison: larger effects on bulky attackers
    //sleep: bad for everyone
    //freeze: quite unfortunate.
    features.myStatus = _.reduce(battle.p1.pokemon, function(memo, pokemon) {
        return memo + (pokemon.status && pokemon.hp?1:0);
    }, 0);
    features.theirStatus = _.reduce(battle.p2.pokemon, function(memo, pokemon) {
        return memo + (pokemon.status && pokemon.hp?1:0);
    }, 0);

    //hazards and reflect/light screen/tailwind
    //For hazards in particular, they're not as useful towards the end of the match...
    features.myHazards = Object.keys(battle.p1.sideConditions).length;
    features.theirHazards = Object.keys(battle.p2.sideConditions).length;

    //leech seed/infestation/confusion
    var harmfulVolatiles = ['confusion', 'leechseed', 'infestation'];
    features.myVolatiles = _.reduce(harmfulVolatiles, function(memo, volatile) {
        return memo + (volatile in battle.p1.active[0].volatiles?1:0);
    }, 0);
    features.theirVolatiles = _.reduce(harmfulVolatiles, function(memo, volatile) {
        return memo + (volatile in battle.p2.active[0].volatiles?1:0);
    }, 0);

    //stat boosts (note: some stats don't really matter for a pokemon, like physical attacks)
    features.myStats = _.reduce(battle.p1.pokemon, function(memo, pokemon) {
        if(pokemon.hp)
            return memo;
        var numStats = 0;
        for(var stat in pokemon.boosts) {
            if(stat !== 'accuracy' && stat !== 'evasion')
                numStats += pokemon.boosts[stat];
        }
        return memo + numStats;
    }, 0);
    features.theirStats = _.reduce(battle.p2.pokemon, function(memo, pokemon) {
        if(!pokemon.hp)
            return memo;
        var numStats = 0;
        for(var stat in pokemon.boosts) {
            if(stat !== 'accuracy' && stat !== 'evasion')
                numStats += pokemon.boosts[stat];
        }
        return memo + numStats;
    }, 0);

    //substitute/etc.
    features.mySub = ('substitute' in battle.p1.active[0].volatiles?1:0);
    features.theirSub = ('substitute' in battle.p2.active[0].volatiles?1:0);

    //items: prefer to have items rather than lose them (such as berries, focus sash, ...)
    features.myItems = _.reduce(battle.p1.pokemon, function(memo, pokemon) {
        return memo + (pokemon.item&&pokemon.hp?1:0);
    }, 0);
    features.theirItems = _.reduce(battle.p2.pokemon, function(memo, pokemon) {
        return memo + (pokemon.item&&pokemon.hp?1:0);
    }, 0);

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

var weights = {
    mySum: 50, //health is most important
    theirSum: -50,
    myAlive: 20, //alive pokemon is next most important
    theirAlive: -20,
    myStatus: 4,
    theirStatus: -4,
    myHazards: 1,
    theirHazards: -1,
    myVolatiles: 2,
    theirVolatiles: -2,
    myStats: 10,
    theirStatus: -10,
    mySub: 5,
    theirSub: -5,
    myItems: 4,
    theirItems: -4
};
//TODO: Eval function needs to be made 1000x better
function eval(battle) {
    var features = getFeatures(battle);
    var value = 0;

    if(program.net === "none") {
        for (var key in weights) {
            //logger.info(key + " " + weights[key] + " * " + features[key]);
            value += weights[key] * features[key];
        }
    } else if (program.net === "update" || program.net === "use") {
        var vec = new convnetjs.Vol(_.values(features));
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

var GAME_END_REWARD = 1000;

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
	var playerAlive = _.any(battle.p1.pokemon, function(pokemon) { return pokemon.hp > 0; });
	var opponentAlive = _.any(battle.p2.pokemon, function(pokemon) { return pokemon.hp > 0; });
	if (!playerAlive || !opponentAlive) {
		node.value = playerAlive ? GAME_END_REWARD : -GAME_END_REWARD;
		return node;
	}

	if(depth == 0) {
		node.value = eval(battle);
	} else {
		// If the request is a wait request, the opposing player has to take a turn. Don't decrement depth.
		if(battle.p1.request.wait) {
			return opponentTurn(battle, depth, alpha, beta, null);
		}
		var choices = (givenchoices) ? givenchoices : BattleRoom.parseRequest(battle.p1.request).choices;
                logger.info("Our choices: " + choices);
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

            if(program.net === "update") train_net(battle, newbattle);

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
