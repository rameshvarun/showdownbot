// Globals
require('sugar');
require('./globals');

// Logging
var log4js = require('log4js');
var logger = require('log4js').getLogger("battlepokemon");

BattlePokemon = (function () {
	function BattlePokemon(set, side) {
		this.side = side;
		this.battle = side.battle;

		var pokemonScripts = this.battle.data.Scripts.pokemon;
		if (pokemonScripts) Object.assign(this, pokemonScripts);

		if (typeof set === 'string') set = {name: set};

		// "pre-bound" functions for nicer syntax (avoids repeated use of `bind`)
		this.getHealth = this.getHealth || BattlePokemon.getHealth.bind(this);
		this.getDetails = this.getDetails || BattlePokemon.getDetails.bind(this);

		this.set = set;

		this.baseTemplate = this.battle.getTemplate(set.species || set.name);
		if (!this.baseTemplate.exists) {
			this.battle.debug('Unidentified species: ' + this.species);
			this.baseTemplate = this.battle.getTemplate('Bulbasaur');
		}
		this.species = this.baseTemplate.species;
		if (set.name === set.species || !set.name || !set.species) {
			set.name = this.species;
		}
		this.name = (set.name || set.species || 'Bulbasaur').substr(0, 20);
		this.speciesid = toId(this.species);
		this.template = this.baseTemplate;
		this.moves = [];
		this.baseMoves = this.moves;
		this.movepp = {};
		this.moveset = [];
		this.baseMoveset = [];

		this.level = this.battle.clampIntRange(set.forcedLevel || set.level || 100, 1, 1000);

		var genders = {M:'M', F:'F'};
		this.gender = this.template.gender || genders[set.gender] || (Math.random() * 2 < 1 ? 'M' : 'F');
		if (this.gender === 'N') this.gender = '';
		this.happiness = typeof set.happiness === 'number' ? this.battle.clampIntRange(set.happiness, 0, 255) : 255;
		this.pokeball = this.set.pokeball || 'pokeball';

		this.fullname = this.side.id + ': ' + this.name;
		this.details = this.species + (this.level === 100 ? '' : ', L' + this.level) + (this.gender === '' ? '' : ', ' + this.gender) + (this.set.shiny ? ', shiny' : '');

		this.id = this.fullname; // shouldn't really be used anywhere

		this.statusData = {};
		this.volatiles = {};
		this.negateImmunity = {};

		this.height = this.template.height;
		this.heightm = this.template.heightm;
		this.weight = this.template.weight;
		this.weightkg = this.template.weightkg;

		this.ignore = {};

		this.baseAbility = toId(set.ability);
		this.ability = this.baseAbility;
		this.item = toId(set.item);
		var forme;
		if (this.baseTemplate.otherFormes) forme = this.battle.getTemplate(this.baseTemplate.otherFormes[0]);
		this.canMegaEvo = ((this.battle.getItem(this.item).megaEvolves === this.baseTemplate.baseSpecies) || (forme && forme.isMega && forme.requiredMove && this.set.moves.indexOf(toId(forme.requiredMove)) > -1));
		this.abilityData = {id: this.ability};
		this.itemData = {id: this.item};
		this.speciesData = {id: this.speciesid};

		this.types = this.baseTemplate.types;
		this.typesData = [];

		for (var i = 0, l = this.types.length; i < l; i++) {
			this.typesData.push({
				type: this.types[i],
				suppressed: false,
				isAdded: false
			});
		}

		if (this.set.moves) {
			for (var i = 0; i < this.set.moves.length; i++) {
				var move = this.battle.getMove(this.set.moves[i]);
				if (!move.id) continue;
				if (move.id === 'hiddenpower') {
					if (!this.set.ivs || Object.values(this.set.ivs).every(31)) {
						this.set.ivs = this.battle.getType(move.type).HPivs;
					}
					move = this.battle.getMove('hiddenpower');
				}
				this.baseMoveset.push({
					move: move.name,
					id: move.id,
					pp: (move.noPPBoosts ? move.pp : move.pp * 8 / 5),
					maxpp: (move.noPPBoosts ? move.pp : move.pp * 8 / 5),
					target: (move.nonGhostTarget && !this.hasType('Ghost') ? move.nonGhostTarget : move.target),
					disabled: false,
					used: false
				});
				this.moves.push(move.id);
			}
		}

		if (!this.set.evs) {
			this.set.evs = {hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84};
		}
		if (!this.set.ivs) {
			this.set.ivs = {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31};
		}
		var stats = {hp: 31, atk: 31, def: 31, spe: 31, spa: 31, spd: 31};
		for (var i in stats) {
			if (!this.set.evs[i]) this.set.evs[i] = 0;
			if (!this.set.ivs[i] && this.set.ivs[i] !== 0) this.set.ivs[i] = 31;
		}
		for (var i in this.set.evs) {
			this.set.evs[i] = this.battle.clampIntRange(this.set.evs[i], 0, 255);
		}
		for (var i in this.set.ivs) {
			this.set.ivs[i] = this.battle.clampIntRange(this.set.ivs[i], 0, 31);
		}

		var hpTypes = ['Fighting', 'Flying', 'Poison', 'Ground', 'Rock', 'Bug', 'Ghost', 'Steel', 'Fire', 'Water', 'Grass', 'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark'];
		if (this.battle.gen && this.battle.gen === 2) {
			// Gen 2 specific Hidden Power check. IVs are still treated 0-31 so we get them 0-15
			var atkDV = Math.floor(this.set.ivs.atk / 2);
			var defDV = Math.floor(this.set.ivs.def / 2);
			var speDV = Math.floor(this.set.ivs.spe / 2);
			var spcDV = Math.floor(this.set.ivs.spa / 2);
			this.hpType = hpTypes[4 * (atkDV % 4) + (defDV % 4)];
			this.hpPower = Math.floor((5 * ((spcDV >> 3) + (2 * (speDV >> 3)) + (4 * (defDV >> 3)) + (8 * (atkDV >> 3))) + (spcDV > 2 ? 3 : spcDV)) / 2 + 31);
		} else {
			// Hidden Power check for gen 3 onwards
			var hpTypeX = 0, hpPowerX = 0;
			var i = 1;
			for (var s in stats) {
				hpTypeX += i * (this.set.ivs[s] % 2);
				hpPowerX += i * (Math.floor(this.set.ivs[s] / 2) % 2);
				i *= 2;
			}
			this.hpType = hpTypes[Math.floor(hpTypeX * 15 / 63)];
			// In Gen 6, Hidden Power is always 60 base power
			this.hpPower = (this.battle.gen && this.battle.gen < 6) ? Math.floor(hpPowerX * 40 / 63) + 30 : 60;
		}

		this.boosts = {atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0};
		this.stats = {atk:0, def:0, spa:0, spd:0, spe:0};
		this.baseStats = {atk:10, def:10, spa:10, spd:10, spe:10};
		for (var statName in this.baseStats) {
			var stat = this.template.baseStats[statName];
			stat = Math.floor(Math.floor(2 * stat + this.set.ivs[statName] + Math.floor(this.set.evs[statName] / 4)) * this.level / 100 + 5);
			var nature = this.battle.getNature(this.set.nature);
			if (statName === nature.plus) stat *= 1.1;
			if (statName === nature.minus) stat *= 0.9;
			this.baseStats[statName] = Math.floor(stat);
		}

		this.maxhp = Math.floor(Math.floor(2 * this.template.baseStats['hp'] + this.set.ivs['hp'] + Math.floor(this.set.evs['hp'] / 4) + 100) * this.level / 100 + 10);
		if (this.template.baseStats['hp'] === 1) this.maxhp = 1; // shedinja
		this.hp = this.hp || this.maxhp;

		this.baseIvs = this.set.ivs;
		this.baseHpType = this.hpType;
		this.baseHpPower = this.hpPower;

		this.clearVolatile(true);

                logger.trace("Created pokemon " + this.toString());
	}

	BattlePokemon.prototype.trapped = false;
	BattlePokemon.prototype.maybeTrapped = false;
	BattlePokemon.prototype.maybeDisabled = false;
	BattlePokemon.prototype.hp = 0;
	BattlePokemon.prototype.maxhp = 100;
	BattlePokemon.prototype.illusion = null;
	BattlePokemon.prototype.fainted = false;
	BattlePokemon.prototype.lastItem = '';
	BattlePokemon.prototype.ateBerry = false;
	BattlePokemon.prototype.status = '';
	BattlePokemon.prototype.position = 0;

	BattlePokemon.prototype.lastMove = '';
	BattlePokemon.prototype.moveThisTurn = '';

	BattlePokemon.prototype.lastDamage = 0;
	BattlePokemon.prototype.lastAttackedBy = null;
	BattlePokemon.prototype.usedItemThisTurn = false;
	BattlePokemon.prototype.newlySwitched = false;
	BattlePokemon.prototype.beingCalledBack = false;
	BattlePokemon.prototype.isActive = false;
	BattlePokemon.prototype.isStarted = false; // has this pokemon's Start events run yet?
	BattlePokemon.prototype.transformed = false;
	BattlePokemon.prototype.duringMove = false;
	BattlePokemon.prototype.hpType = 'Dark';
	BattlePokemon.prototype.hpPower = 60;
	BattlePokemon.prototype.speed = 0;

	BattlePokemon.prototype.toString = function () {
		var fullname = this.fullname;
		if (this.illusion) fullname = this.illusion.fullname;

		var positionList = 'abcdef';
		if (this.isActive) return fullname.substr(0, 2) + positionList[this.position] + fullname.substr(2);
		return fullname;
	};
	// "static" function
	BattlePokemon.getDetails = function (side) {
		if (this.illusion) return this.illusion.details + '|' + this.getHealth(side);
		return this.details + '|' + this.getHealth(side);
	};
	BattlePokemon.prototype.update = function (init) {
		// reset for Light Metal etc
		this.weightkg = this.template.weightkg;
		// reset for diabled moves
		this.disabledMoves = {};
		this.negateImmunity = {};
		this.trapped = this.maybeTrapped = false;
		this.maybeDisabled = false;
		// reset for ignore settings
		this.ignore = {};
		for (var i in this.moveset) {
			if (this.moveset[i]) this.moveset[i].disabled = false;
		}
		if (init) return;

		if (this.runImmunity('trapped')) this.battle.runEvent('MaybeTrapPokemon', this);
		// Disable the faculty to cancel switches if a foe may have a trapping ability
		for (var i = 0; i < this.battle.sides.length; ++i) {
			var side = this.battle.sides[i];
			if (side === this.side) continue;
			for (var j = 0; j < side.active.length; ++j) {
				var pokemon = side.active[j];
				if (!pokemon || pokemon.fainted) continue;
				var template = (pokemon.illusion || pokemon).template;
				if (!template.abilities) continue;
				for (var k in template.abilities) {
					var ability = template.abilities[k];
					if (ability === pokemon.ability) {
						// This event was already run above so we don't need
						// to run it again.
						continue;
					}
					if ((k === 'H') && template.unreleasedHidden) {
						// unreleased hidden ability
						continue;
					}
					if (this.runImmunity('trapped')) {
						this.battle.singleEvent('FoeMaybeTrapPokemon',
							this.battle.getAbility(ability), {}, this, pokemon);
					}
				}
			}
		}
		this.battle.runEvent('ModifyPokemon', this);

		this.speed = this.getStat('spe');
	};
	BattlePokemon.prototype.calculateStat = function (statName, boost, modifier) {
		statName = toId(statName);

		if (statName === 'hp') return this.maxhp; // please just read .maxhp directly

		// base stat
		var stat = this.stats[statName];

		// stat boosts
		// boost = this.boosts[statName];
		var boostTable = [1, 1.5, 2, 2.5, 3, 3.5, 4];
		if (boost > 6) boost = 6;
		if (boost < -6) boost = -6;
		if (boost >= 0) {
			stat = Math.floor(stat * boostTable[boost]);
		} else {
			stat = Math.floor(stat / boostTable[-boost]);
		}

		// stat modifier
		stat = this.battle.modify(stat, (modifier || 1));

		if (this.battle.getStatCallback) {
			stat = this.battle.getStatCallback(stat, statName, this);
		}

		return stat;
	};
	BattlePokemon.prototype.getStat = function (statName, unboosted, unmodified) {
		statName = toId(statName);

		if (statName === 'hp') return this.maxhp; // please just read .maxhp directly

		// base stat
		var stat = this.stats[statName];

		// stat boosts
		if (!unboosted) {
			var boost = this.boosts[statName];
			var boostTable = [1, 1.5, 2, 2.5, 3, 3.5, 4];
			if (boost > 6) boost = 6;
			if (boost < -6) boost = -6;
			if (boost >= 0) {
				stat = Math.floor(stat * boostTable[boost]);
			} else {
				stat = Math.floor(stat / boostTable[-boost]);
			}
		}

		// stat modifier effects
		if (!unmodified) {
			var statTable = {atk:'Atk', def:'Def', spa:'SpA', spd:'SpD', spe:'Spe'};
			var statMod = 1;
			statMod = this.battle.runEvent('Modify' + statTable[statName], this, null, null, statMod);
			stat = this.battle.modify(stat, statMod);
		}
		if (this.battle.getStatCallback) {
			stat = this.battle.getStatCallback(stat, statName, this, unboosted);
		}
		return stat;
	};
	BattlePokemon.prototype.getMoveData = function (move) {
		move = this.battle.getMove(move);
		for (var i = 0; i < this.moveset.length; i++) {
			var moveData = this.moveset[i];
			if (moveData.id === move.id) {
				return moveData;
			}
		}
		return null;
	};
	BattlePokemon.prototype.deductPP = function (move, amount, source) {
		move = this.battle.getMove(move);
		var ppData = this.getMoveData(move);
		var success = false;
		if (ppData) {
			ppData.used = true;
		}
		if (ppData && ppData.pp) {
			ppData.pp -= this.battle.runEvent('DeductPP', this, source || this, move, amount || 1);
			if (ppData.pp <= 0) {
				ppData.pp = 0;
			}
			success = true;
		}
		return success;
	};
	BattlePokemon.prototype.moveUsed = function (move) {
		this.lastMove = this.battle.getMove(move).id;
		this.moveThisTurn = this.lastMove;
	};
	BattlePokemon.prototype.gotAttacked = function (move, damage, source) {
		if (!damage) damage = 0;
		move = this.battle.getMove(move);
		this.lastAttackedBy = {
			pokemon: source,
			damage: damage,
			move: move.id,
			thisTurn: true
		};
	};
	BattlePokemon.prototype.getLockedMove = function () {
		var lockedMove = this.battle.runEvent('LockMove', this);
		if (lockedMove === true) lockedMove = false;
		return lockedMove;
	};
	BattlePokemon.prototype.getMoves = function (lockedMove, restrictData) {
		if (lockedMove) {
			lockedMove = toId(lockedMove);
			this.trapped = true;
		}
		if (lockedMove === 'recharge') {
			return [{
				move: 'Recharge',
				id: 'recharge'
			}];
		}
		var moves = [];
		var hasValidMove = false;
		for (var i = 0; i < this.moveset.length; i++) {
			var move = this.moveset[i];
			if (lockedMove) {
				if (lockedMove === move.id) {
					return [{
						move: move.move,
						id: move.id
					}];
				}
				continue;
			}
			if (this.disabledMoves[move.id] && (!restrictData || !this.disabledMoves[move.id].isHidden) || !move.pp && (this.battle.gen !== 1 || !this.volatiles['partialtrappinglock'])) {
				move.disabled = !restrictData && this.disabledMoves[move.id] && this.disabledMoves[move.id].isHidden ? 'hidden' : true;
			} else if (!move.disabled || move.disabled === 'hidden' && restrictData) {
				hasValidMove = true;
			}
			var moveName = move.move;
			if (move.id === 'hiddenpower') {
				moveName = 'Hidden Power ' + this.hpType;
				if (this.gen < 6) moveName += ' ' + this.hpPower;
			}
			moves.push({
				move: moveName,
				id: move.id,
				pp: move.pp,
				maxpp: move.maxpp,
				target: move.target,
				disabled: move.disabled
			});
		}
		if (lockedMove) {
			return [{
				move: this.battle.getMove(lockedMove).name,
				id: lockedMove
			}];
		}
		if (hasValidMove) return moves;

		return [{
			move: 'Struggle',
			id: 'struggle'
		}];
	};
	BattlePokemon.prototype.getRequestData = function () {
		var lockedMove = this.getLockedMove();

		// Information should be restricted for the last active Pok�mon
		var isLastActive = this.isLastActive();
		var data = {moves: this.getMoves(lockedMove, isLastActive)};

		if (isLastActive) {
			if (this.maybeDisabled) {
				data.maybeDisabled = true;
			}
			if (this.trapped === true) {
				data.trapped = true;
			} else if (this.maybeTrapped) {
				data.maybeTrapped = true;
			}
		} else {
			if (this.trapped) data.trapped = true;
		}

		return data;
	};
	BattlePokemon.prototype.isLastActive = function () {
		if (!this.isActive) return false;

		var allyActive = this.side.active;
		for (var i = this.position + 1; i < allyActive.length; i++) {
			if (allyActive[i] && !allyActive.fainted) return false;
		}
		return true;
	};
	BattlePokemon.prototype.positiveBoosts = function () {
		var boosts = 0;
		for (var i in this.boosts) {
			if (this.boosts[i] > 0) boosts += this.boosts[i];
		}
		return boosts;
	};
	BattlePokemon.prototype.boostBy = function (boost) {
		var changed = false;
		for (var i in boost) {
			var delta = boost[i];
			this.boosts[i] += delta;
			if (this.boosts[i] > 6) {
				delta -= this.boosts[i] - 6;
				this.boosts[i] = 6;
			}
			if (this.boosts[i] < -6) {
				delta -= this.boosts[i] - (-6);
				this.boosts[i] = -6;
			}
			if (delta) changed = true;
		}
		this.update();
		return changed;
	};
	BattlePokemon.prototype.clearBoosts = function () {
		for (var i in this.boosts) {
			this.boosts[i] = 0;
		}
		this.update();
	};
	BattlePokemon.prototype.setBoost = function (boost) {
		for (var i in boost) {
			this.boosts[i] = boost[i];
		}
		this.update();
	};
	BattlePokemon.prototype.copyVolatileFrom = function (pokemon) {
		this.clearVolatile();
		this.boosts = pokemon.boosts;
		for (var i in pokemon.volatiles) {
			if (this.battle.getEffect(i).noCopy) continue;
			// shallow clones
			this.volatiles[i] = Object.clone(pokemon.volatiles[i]);
			if (this.volatiles[i].linkedPokemon) {
				delete pokemon.volatiles[i].linkedPokemon;
				delete pokemon.volatiles[i].linkedStatus;
				this.volatiles[i].linkedPokemon.volatiles[this.volatiles[i].linkedStatus].linkedPokemon = this;
			}
		}
		pokemon.clearVolatile();
		this.update();
		for (var i in this.volatiles) {
			this.battle.singleEvent('Copy', this.getVolatile(i), this.volatiles[i], this);
		}
	};
	BattlePokemon.prototype.transformInto = function (pokemon, user) {
		var template = pokemon.template;
		if (pokemon.fainted || pokemon.illusion || (pokemon.volatiles['substitute'] && this.battle.gen >= 5)) {
			return false;
		}
		if (!template.abilities || (pokemon && pokemon.transformed && this.battle.gen >= 2) || (user && user.transformed && this.battle.gen >= 5)) {
			return false;
		}
		if (!this.formeChange(template, true)) {
			return false;
		}
		this.transformed = true;
		this.typesData = [];
		for (var i = 0, l = pokemon.typesData.length; i < l; i++) {
			this.typesData.push({
				type: pokemon.typesData[i].type,
				suppressed: false,
				isAdded: pokemon.typesData[i].isAdded
			});
		}
		for (var statName in this.stats) {
			this.stats[statName] = pokemon.stats[statName];
		}
		this.moveset = [];
		this.moves = [];
		this.set.ivs = (this.battle.gen >= 5 ? this.set.ivs : pokemon.set.ivs);
		this.hpType = (this.battle.gen >= 5 ? this.hpType : pokemon.hpType);
		this.hpPower = (this.battle.gen >= 5 ? this.hpPower : pokemon.hpPower);
		for (var i = 0; i < pokemon.moveset.length; i++) {
			var move = this.battle.getMove(this.set.moves[i]);
			var moveData = pokemon.moveset[i];
			var moveName = moveData.move;
			if (moveData.id === 'hiddenpower') {
				moveName = 'Hidden Power ' + this.hpType;
			}
			this.moveset.push({
				move: moveName,
				id: moveData.id,
				pp: move.noPPBoosts ? moveData.maxpp : 5,
				maxpp: this.battle.gen >= 5 ? (move.noPPBoosts ? moveData.maxpp : 5) : (this.battle.gen <= 2 ? move.pp : moveData.maxpp),
				target: moveData.target,
				disabled: false
			});
			this.moves.push(toId(moveName));
		}
		for (var j in pokemon.boosts) {
			this.boosts[j] = pokemon.boosts[j];
		}
		this.battle.add('-transform', this, pokemon);
		this.setAbility(pokemon.ability);
		this.update();
		return true;
	};
	BattlePokemon.prototype.formeChange = function (template, dontRecalculateStats) {
		template = this.battle.getTemplate(template);

		if (!template.abilities) return false;
		this.illusion = null;
		this.template = template;
		this.types = template.types;
		this.typesData = [];
		this.types = template.types;
		for (var i = 0, l = this.types.length; i < l; i++) {
			this.typesData.push({
				type: this.types[i],
				suppressed: false,
				isAdded: false
			});
		}
		if (!dontRecalculateStats) {
			for (var statName in this.stats) {
				var stat = this.template.baseStats[statName];
				stat = Math.floor(Math.floor(2 * stat + this.set.ivs[statName] + Math.floor(this.set.evs[statName] / 4)) * this.level / 100 + 5);

				// nature
				var nature = this.battle.getNature(this.set.nature);
				if (statName === nature.plus) stat *= 1.1;
				if (statName === nature.minus) stat *= 0.9;
				this.baseStats[statName] = this.stats[statName] = Math.floor(stat);
			}
			this.speed = this.stats.spe;
		}
		return true;
	};
	BattlePokemon.prototype.clearVolatile = function (init) {
		this.boosts = {
			atk: 0,
			def: 0,
			spa: 0,
			spd: 0,
			spe: 0,
			accuracy: 0,
			evasion: 0
		};

		this.moveset = this.baseMoveset.slice();
		this.moves = this.moveset.map(function (move) {
			return toId(move.move);
		});

		this.transformed = false;
		this.ability = this.baseAbility;
		this.set.ivs = this.baseIvs;
		this.hpType = this.baseHpType;
		this.hpPower = this.baseHpPower;
		for (var i in this.volatiles) {
			if (this.volatiles[i].linkedStatus) {
				this.volatiles[i].linkedPokemon.removeVolatile(this.volatiles[i].linkedStatus);
			}
		}
		this.volatiles = {};
		this.switchFlag = false;

		this.lastMove = '';
		this.moveThisTurn = '';

		this.lastDamage = 0;
		this.lastAttackedBy = null;
		this.newlySwitched = true;
		this.beingCalledBack = false;

		this.formeChange(this.baseTemplate);

		this.update(init);
	};
	BattlePokemon.prototype.hasType = function (type) {
		if (!type) return false;
		if (Array.isArray(type)) {
			for (var i = 0; i < type.length; i++) {
				if (this.hasType(type[i])) return true;
			}
		} else {
			if (this.getTypes().indexOf(type) > -1) return true;
		}
		return false;
	};
	// returns the amount of damage actually dealt
	BattlePokemon.prototype.faint = function (source, effect) {
		// This function only puts the pokemon in the faint queue;
		// actually setting of this.fainted comes later when the
		// faint queue is resolved.
		if (this.fainted || this.status === 'fnt') return 0;
		var d = this.hp;
		this.hp = 0;
		this.switchFlag = false;
		this.status = 'fnt';
		this.battle.faintQueue.push({
			target: this,
			source: source,
			effect: effect
		});
		return d;
	};
	BattlePokemon.prototype.damage = function (d, source, effect) {
		if (!this.hp) return 0;
		if (d < 1 && d > 0) d = 1;
		d = Math.floor(d);
		if (isNaN(d)) return 0;
		if (d <= 0) return 0;
		this.hp -= d;
		if (this.hp <= 0) {
			d += this.hp;
			this.faint(source, effect);
		}
		return d;
	};
	BattlePokemon.prototype.tryTrap = function (isHidden) {
		if (this.runImmunity('trapped')) {
			if (this.trapped && isHidden) return true;
			this.trapped = isHidden ? 'hidden' : true;
			return true;
		}
		return false;
	};
	BattlePokemon.prototype.hasMove = function (moveid) {
		moveid = toId(moveid);
		if (moveid.substr(0, 11) === 'hiddenpower') moveid = 'hiddenpower';
		for (var i = 0; i < this.moveset.length; i++) {
			if (moveid === this.battle.getMove(this.moveset[i].move).id) {
				return moveid;
			}
		}
		return false;
	};
	BattlePokemon.prototype.getValidMoves = function (lockedMove) {
		var pMoves = this.getMoves(lockedMove);
		var moves = [];
		for (var i = 0; i < pMoves.length; i++) {
			if (!pMoves[i].disabled) {
				moves.push(pMoves[i].id);
			}
		}
		if (!moves.length) return ['struggle'];
		return moves;
	};
	BattlePokemon.prototype.disableMove = function (moveid, isHidden, sourceEffect) {
		if (!sourceEffect && this.battle.event) {
			sourceEffect = this.battle.effect;
		}
		moveid = toId(moveid);
		if (moveid.substr(0, 11) === 'hiddenpower') moveid = 'hiddenpower';

		if (this.disabledMoves[moveid] && !this.disabledMoves[moveid].isHidden) return;
		this.disabledMoves[moveid] = {
			isHidden: !!isHidden,
			sourceEffect: sourceEffect
		};
	};
	// returns the amount of damage actually healed
	BattlePokemon.prototype.heal = function (d) {
		if (!this.hp) return false;
		d = Math.floor(d);
		if (isNaN(d)) return false;
		if (d <= 0) return false;
		if (this.hp >= this.maxhp) return false;
		this.hp += d;
		if (this.hp > this.maxhp) {
			d -= this.hp - this.maxhp;
			this.hp = this.maxhp;
		}
		return d;
	};
	// sets HP, returns delta
	BattlePokemon.prototype.sethp = function (d) {
		if (!this.hp) return 0;
		d = Math.floor(d);
		if (isNaN(d)) return;
		if (d < 1) d = 1;
		d = d - this.hp;
		this.hp += d;
		if (this.hp > this.maxhp) {
			d -= this.hp - this.maxhp;
			this.hp = this.maxhp;
		}
		return d;
	};
	BattlePokemon.prototype.trySetStatus = function (status, source, sourceEffect) {
		if (!this.hp) return false;
		if (this.status) return false;
		return this.setStatus(status, source, sourceEffect);
	};
	BattlePokemon.prototype.cureStatus = function () {
		if (!this.hp) return false;
		// unlike clearStatus, gives cure message
		if (this.status) {
			this.battle.add('-curestatus', this, this.status);
			this.setStatus('');
		}
	};
	BattlePokemon.prototype.setStatus = function (status, source, sourceEffect, ignoreImmunities) {
		if (!this.hp) return false;
		status = this.battle.getEffect(status);
		if (this.battle.event) {
			if (!source) source = this.battle.event.source;
			if (!sourceEffect) sourceEffect = this.battle.effect;
		}

		if (!ignoreImmunities && status.id) {
			// the game currently never ignores immunities
			if (!this.runImmunity(status.id === 'tox' ? 'psn' : status.id)) {
				this.battle.debug('immune to status');
				return false;
			}
		}

		if (this.status === status.id) return false;
		var prevStatus = this.status;
		var prevStatusData = this.statusData;
		if (status.id && !this.battle.runEvent('SetStatus', this, source, sourceEffect, status)) {
			this.battle.debug('set status [' + status.id + '] interrupted');
			return false;
		}

		this.status = status.id;
		this.statusData = {id: status.id, target: this};
		if (source) this.statusData.source = source;
		if (status.duration) {
			this.statusData.duration = status.duration;
		}
		if (status.durationCallback) {
			this.statusData.duration = status.durationCallback.call(this.battle, this, source, sourceEffect);
		}

		if (status.id && !this.battle.singleEvent('Start', status, this.statusData, this, source, sourceEffect)) {
			this.battle.debug('status start [' + status.id + '] interrupted');
			// cancel the setstatus
			this.status = prevStatus;
			this.statusData = prevStatusData;
			return false;
		}
		this.update();
		if (status.id && !this.battle.runEvent('AfterSetStatus', this, source, sourceEffect, status)) {
			return false;
		}
		return true;
	};
	BattlePokemon.prototype.clearStatus = function () {
		// unlike cureStatus, does not give cure message
		return this.setStatus('');
	};
	BattlePokemon.prototype.getStatus = function () {
		return this.battle.getEffect(this.status);
	};
	BattlePokemon.prototype.eatItem = function (item, source, sourceEffect) {
		if (!this.hp || !this.isActive) return false;
		if (!this.item) return false;

		var id = toId(item);
		if (id && this.item !== id) return false;

		if (!sourceEffect && this.battle.effect) sourceEffect = this.battle.effect;
		if (!source && this.battle.event && this.battle.event.target) source = this.battle.event.target;
		item = this.getItem();
		if (this.battle.runEvent('UseItem', this, null, null, item) && this.battle.runEvent('EatItem', this, null, null, item)) {
			this.battle.add('-enditem', this, item, '[eat]');

			this.battle.singleEvent('Eat', item, this.itemData, this, source, sourceEffect);

			this.lastItem = this.item;
			this.item = '';
			this.itemData = {id: '', target: this};
			this.usedItemThisTurn = true;
			this.ateBerry = true;
			this.battle.runEvent('AfterUseItem', this, null, null, item);
			return true;
		}
		return false;
	};
	BattlePokemon.prototype.useItem = function (item, source, sourceEffect) {
		if (!this.isActive) return false;
		if (!this.item) return false;

		var id = toId(item);
		if (id && this.item !== id) return false;

		if (!sourceEffect && this.battle.effect) sourceEffect = this.battle.effect;
		if (!source && this.battle.event && this.battle.event.target) source = this.battle.event.target;
		item = this.getItem();
		if (this.battle.runEvent('UseItem', this, null, null, item)) {
			switch (item.id) {
			case 'redcard':
				this.battle.add('-enditem', this, item, '[of] ' + source);
				break;
			default:
				if (!item.isGem) {
					this.battle.add('-enditem', this, item);
				}
				break;
			}

			this.battle.singleEvent('Use', item, this.itemData, this, source, sourceEffect);

			this.lastItem = this.item;
			this.item = '';
			this.itemData = {id: '', target: this};
			this.usedItemThisTurn = true;
			this.battle.runEvent('AfterUseItem', this, null, null, item);
			return true;
		}
		return false;
	};
	BattlePokemon.prototype.takeItem = function (source) {
		if (!this.isActive) return false;
		if (!this.item) return false;
		if (!source) source = this;
		var item = this.getItem();
		if (this.battle.runEvent('TakeItem', this, source, null, item)) {
			this.lastItem = '';
			this.item = '';
			this.itemData = {id: '', target: this};
			return item;
		}
		return false;
	};
	BattlePokemon.prototype.setItem = function (item, source, effect) {
		if (!this.hp || !this.isActive) return false;
		item = this.battle.getItem(item);
		this.lastItem = this.item;
		this.item = item.id;
		this.itemData = {id: item.id, target: this};
		if (item.id) {
			this.battle.singleEvent('Start', item, this.itemData, this, source, effect);
		}
		if (this.lastItem) this.usedItemThisTurn = true;
		return true;
	};
	BattlePokemon.prototype.getItem = function () {
		return this.battle.getItem(this.item);
	};
	BattlePokemon.prototype.hasItem = function (item) {
		if (this.ignore['Item']) return false;
		var ownItem = this.item;
		if (!Array.isArray(item)) {
			return ownItem === toId(item);
		}
		return (item.map(toId).indexOf(ownItem) >= 0);
	};
	BattlePokemon.prototype.clearItem = function () {
		return this.setItem('');
	};
	BattlePokemon.prototype.setAbility = function (ability, source, effect, noForce) {
		if (!this.hp) return false;
		ability = this.battle.getAbility(ability);
		var oldAbility = this.ability;
		if (noForce && oldAbility === ability.id) {
			return false;
		}
		if (ability.id in {illusion:1, multitype:1, stancechange:1}) return false;
		if (oldAbility in {multitype:1, stancechange:1}) return false;
		this.battle.singleEvent('End', this.battle.getAbility(oldAbility), this.abilityData, this, source, effect);
		this.ability = ability.id;
		this.abilityData = {id: ability.id, target: this};
		if (ability.id && this.battle.gen > 3) {
			this.battle.singleEvent('Start', ability, this.abilityData, this, source, effect);
		}
		return oldAbility;
	};
	BattlePokemon.prototype.getAbility = function () {
		return this.battle.getAbility(this.ability);
	};
	BattlePokemon.prototype.hasAbility = function (ability) {
		if (this.ignore['Ability']) return false;
		var ownAbility = this.ability;
		if (!Array.isArray(ability)) {
			return ownAbility === toId(ability);
		}
		return (ability.map(toId).indexOf(ownAbility) >= 0);
	};
	BattlePokemon.prototype.clearAbility = function () {
		return this.setAbility('');
	};
	BattlePokemon.prototype.getNature = function () {
		return this.battle.getNature(this.set.nature);
	};
	BattlePokemon.prototype.addVolatile = function (status, source, sourceEffect, linkedStatus) {
		var result;
		status = this.battle.getEffect(status);
		if (!this.hp && !status.affectsFainted) return false;
		if (this.battle.event) {
			if (!source) source = this.battle.event.source;
			if (!sourceEffect) sourceEffect = this.battle.effect;
		}

		if (this.volatiles[status.id]) {
			if (!status.onRestart) return false;
			return this.battle.singleEvent('Restart', status, this.volatiles[status.id], this, source, sourceEffect);
		}
		if (!this.runImmunity(status.id)) return false;
		result = this.battle.runEvent('TryAddVolatile', this, source, sourceEffect, status);
		if (!result) {
			this.battle.debug('add volatile [' + status.id + '] interrupted');
			return result;
		}
		this.volatiles[status.id] = {id: status.id};
		this.volatiles[status.id].target = this;
		if (source) {
			this.volatiles[status.id].source = source;
			this.volatiles[status.id].sourcePosition = source.position;
		}
		if (sourceEffect) {
			this.volatiles[status.id].sourceEffect = sourceEffect;
		}
		if (status.duration) {
			this.volatiles[status.id].duration = status.duration;
		}
		if (status.durationCallback) {
			this.volatiles[status.id].duration = status.durationCallback.call(this.battle, this, source, sourceEffect);
		}
		result = this.battle.singleEvent('Start', status, this.volatiles[status.id], this, source, sourceEffect);
		if (!result) {
			// cancel
			delete this.volatiles[status.id];
			return result;
		}
		if (linkedStatus && source && !source.volatiles[linkedStatus]) {
			source.addVolatile(linkedStatus, this, sourceEffect, status);
			source.volatiles[linkedStatus].linkedPokemon = this;
			source.volatiles[linkedStatus].linkedStatus = status;
			this.volatiles[status].linkedPokemon = source;
			this.volatiles[status].linkedStatus = linkedStatus;
		}
		this.update();
		return true;
	};
	BattlePokemon.prototype.getVolatile = function (status) {
		status = this.battle.getEffect(status);
		if (!this.volatiles[status.id]) return null;
		return status;
	};
	BattlePokemon.prototype.removeVolatile = function (status) {
		if (!this.hp) return false;
		status = this.battle.getEffect(status);
		if (!this.volatiles[status.id]) return false;
		this.battle.singleEvent('End', status, this.volatiles[status.id], this);
		var linkedPokemon = this.volatiles[status.id].linkedPokemon;
		var linkedStatus = this.volatiles[status.id].linkedStatus;
		delete this.volatiles[status.id];
		if (linkedPokemon && linkedPokemon.volatiles[linkedStatus]) {
			linkedPokemon.removeVolatile(linkedStatus);
		}
		this.update();
		return true;
	};
	// "static" function
	BattlePokemon.getHealth = function (side) {
		if (!this.hp) return '0 fnt';
		var hpstring;
		if ((side === true) || (this.side === side) || this.battle.getFormat().debug) {
			hpstring = '' + this.hp + '/' + this.maxhp;
		} else {
			var ratio = this.hp / this.maxhp;
			if (this.battle.reportPercentages) {
				// HP Percentage Mod mechanics
				var percentage = Math.ceil(ratio * 100);
				if ((percentage === 100) && (ratio < 1.0)) {
					percentage = 99;
				}
				hpstring = '' + percentage + '/100';
			} else {
				// In-game accurate pixel health mechanics
				var pixels = Math.floor(ratio * 48) || 1;
				hpstring = '' + pixels + '/48';
				if ((pixels === 9) && (ratio > 0.2)) {
					hpstring += 'y'; // force yellow HP bar
				} else if ((pixels === 24) && (ratio > 0.5)) {
					hpstring += 'g'; // force green HP bar
				}
			}
		}
		if (this.status) hpstring += ' ' + this.status;
		return hpstring;
	};
	BattlePokemon.prototype.setType = function (newType, enforce) {
		// Arceus first type cannot be normally changed
		if (!enforce && this.template.num === 493) return false;

		this.typesData = [{
			type: newType,
			suppressed: false,
			isAdded: false
		}];

		return true;
	};
	BattlePokemon.prototype.addType = function (newType) {
		// removes any types added previously and adds another one

		this.typesData = this.typesData.filter(function (typeData) {
			return !typeData.isAdded;
		}).concat([{
			type: newType,
			suppressed: false,
			isAdded: true
		}]);

		return true;
	};
	BattlePokemon.prototype.getTypes = function (getAll) {
		var types = [];
		for (var i = 0, l = this.typesData.length; i < l; i++) {
			if (getAll || !this.typesData[i].suppressed) {
				types.push(this.typesData[i].type);
			}
		}
		if (types.length) return types;
		if (this.battle.gen >= 5) return ['Normal'];
		return ['???'];
	};
	BattlePokemon.prototype.runEffectiveness = function (move) {
		var totalTypeMod = 0;
		var types = this.getTypes();
		for (var i = 0; i < types.length; i++) {
			var typeMod = this.battle.getEffectiveness(move, types[i]);
			typeMod = this.battle.singleEvent('Effectiveness', move, null, types[i], move, null, typeMod);
			totalTypeMod += this.battle.runEvent('Effectiveness', this, types[i], move, typeMod);
		}
		return totalTypeMod;
	};
	BattlePokemon.prototype.runImmunity = function (type, message) {
		if (this.fainted) {
			return false;
		}
		if (!type || type === '???') {
			return true;
		}
		if (this.negateImmunity[type]) return true;
		if (!(this.negateImmunity['Type'] && type in this.battle.data.TypeChart)) {
			// Ring Target not active
			if (!this.battle.getImmunity(type, this)) {
				this.battle.debug('natural immunity');
				if (message) {
					this.battle.add('-immune', this, '[msg]');
				}
				return false;
			}
		}
		var immunity = this.battle.runEvent('Immunity', this, null, null, type);
		if (!immunity) {
			this.battle.debug('artificial immunity');
			if (message && immunity !== null) {
				this.battle.add('-immune', this, '[msg]');
			}
			return false;
		}
		return true;
	};
	BattlePokemon.prototype.destroy = function () {
		// deallocate ourself
		// get rid of some possibly-circular references
		this.battle = null;
		this.side = null;
	};
	return BattlePokemon;
})();

module.exports = BattlePokemon;
