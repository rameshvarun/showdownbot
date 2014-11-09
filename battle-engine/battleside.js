require('sugar');
require('./globals');

// Logging
var log4js = require('log4js');
var logger = require('log4js').getLogger("battleside");
log4js.addAppender(log4js.appenders.file('logs/battleside.log'), 'battleside');

BattlePokemon = require('./battlepokemon')

BattleSide = (function () {
	function BattleSide(name, battle, n, team) {
		var sideScripts = battle.data.Scripts.side;
		if (sideScripts) Object.merge(this, sideScripts);

		this.battle = battle;
		this.n = n;
		this.name = name;
		this.pokemon = [];
		this.active = [null];
		this.sideConditions = {};

		this.id = n ? 'p2' : 'p1';

		switch (this.battle.gameType) {
		case 'doubles':
			this.active = [null, null];
			break;
		case 'triples': case 'rotation':
			this.active = [null, null, null];
			break;
		}

		this.team = this.battle.getTeam(this, team);
		for (var i = 0; i < this.team.length && i < 6; i++) {
			//console.log("NEW POKEMON: " + (this.team[i] ? this.team[i].name : '[unidentified]'));
			logger.trace(JSON.stringify(this.team[i]));
			this.pokemon.push(new BattlePokemon(this.team[i], this));
		}
		this.pokemonLeft = this.pokemon.length;
		for (var i = 0; i < this.pokemon.length; i++) {
			this.pokemon[i].position = i;
		}
	}

	BattleSide.prototype.isActive = false;
	BattleSide.prototype.pokemonLeft = 0;
	BattleSide.prototype.faintedLastTurn = false;
	BattleSide.prototype.faintedThisTurn = false;
	BattleSide.prototype.decision = null;
	BattleSide.prototype.foe = null;

	BattleSide.prototype.toString = function () {
		return this.id + ': ' + this.name;
	};
	BattleSide.prototype.getData = function () {
		var data = {
			name: this.name,
			id: this.id,
			pokemon: []
		};
		for (var i = 0; i < this.pokemon.length; i++) {
			var pokemon = this.pokemon[i];
			data.pokemon.push({
				ident: pokemon.fullname,
				details: pokemon.details,
				condition: pokemon.getHealth(pokemon.side),
				active: (pokemon.position < pokemon.side.active.length),
				stats: {
					atk: pokemon.baseStats['atk'],
					def: pokemon.baseStats['def'],
					spa: pokemon.baseStats['spa'],
					spd: pokemon.baseStats['spd'],
					spe: pokemon.baseStats['spe']
				},
				moves: pokemon.moves.map(function (move) {
					if (move === 'hiddenpower') {
						return move + toId(pokemon.hpType) + (pokemon.hpPower === 70 ? '' : pokemon.hpPower);
					}
					return move;
				}),
				baseAbility: pokemon.baseAbility,
				item: pokemon.item,
				pokeball: pokemon.pokeball,
				canMegaEvo: pokemon.canMegaEvo
			});
		}
		return data;
	};
	BattleSide.prototype.randomActive = function () {
		var actives = this.active.filter(function (active) {
			return active && !active.fainted;
		});
		if (!actives.length) return null;
		var i = Math.floor(Math.random() * actives.length);
		return actives[i];
	};
	BattleSide.prototype.addSideCondition = function (status, source, sourceEffect) {
		status = this.battle.getEffect(status);
		if (this.sideConditions[status.id]) {
			if (!status.onRestart) return false;
			return this.battle.singleEvent('Restart', status, this.sideConditions[status.id], this, source, sourceEffect);
		}
		this.sideConditions[status.id] = {id: status.id};
		this.sideConditions[status.id].target = this;
		if (source) {
			this.sideConditions[status.id].source = source;
			this.sideConditions[status.id].sourcePosition = source.position;
		}
		if (status.duration) {
			this.sideConditions[status.id].duration = status.duration;
		}
		if (status.durationCallback) {
			this.sideConditions[status.id].duration = status.durationCallback.call(this.battle, this, source, sourceEffect);
		}
		if (!this.battle.singleEvent('Start', status, this.sideConditions[status.id], this, source, sourceEffect)) {
			delete this.sideConditions[status.id];
			return false;
		}
		this.battle.update();
		return true;
	};
	BattleSide.prototype.getSideCondition = function (status) {
		status = this.battle.getEffect(status);
		if (!this.sideConditions[status.id]) return null;
		return status;
	};
	BattleSide.prototype.removeSideCondition = function (status) {
		status = this.battle.getEffect(status);
		if (!this.sideConditions[status.id]) return false;
		this.battle.singleEvent('End', status, this.sideConditions[status.id], this);
		delete this.sideConditions[status.id];
		this.battle.update();
		return true;
	};
	BattleSide.prototype.emitCallback = function () {
		this.battle.send('callback', this.id + "\n" +
			Array.prototype.slice.call(arguments).join('|'));
	};
	BattleSide.prototype.emitRequest = function (update) {
		this.battle.send('request', this.id + "\n" + this.battle.rqid + "\n" + JSON.stringify(update));
	};
	BattleSide.prototype.destroy = function () {
		// deallocate ourself

		// deallocate children and get rid of references to them
		for (var i = 0; i < this.pokemon.length; i++) {
			if (this.pokemon[i]) this.pokemon[i].destroy();
			this.pokemon[i] = null;
		}
		this.pokemon = null;
		for (var i = 0; i < this.active.length; i++) {
			this.active[i] = null;
		}
		this.active = null;

		if (this.decision) {
			delete this.decision.side;
			delete this.decision.pokemon;
		}
		this.decision = null;

		// get rid of some possibly-circular references
		this.battle = null;
		this.foe = null;
	};
	return BattleSide;
})();

module.exports = BattleSide