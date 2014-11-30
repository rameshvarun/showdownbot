var express = require('express');
var app = express();
var nunjucks = require('nunjucks');
var bot = require('./bot')
var program = require('commander'); // Get Command-line arguments

// Results database
var db = require("./db");

var _ = require("underscore")

// Setup Logging
var log4js = require('log4js');
var logger = require('log4js').getLogger("webconsole");
log4js.addAppender(log4js.appenders.file('logs/webconsole.log'), 'webconsole');

var CHALLENGING = false;

// Challenging logic
var MAX_ROOMS = 3;
setInterval(function() {
	if(CHALLENGING && _.values(bot.ROOMS).length < MAX_ROOMS) {
		logger.info("Challenging...");
		bot.searchBattle();
	}
}, 45000);

nunjucks.configure('templates', {
	autoescape: true,
	express: app,
	watch: true
});

app.get('/', function(req, res){
	db.find({}).sort({ date: -1}).exec(function(err, history) {
		res.render('home.html', {
			"games" : _.values(bot.ROOMS),
			"domain" : bot.DOMAIN,
			"history" : history,
			"challenging" : CHALLENGING
		});
	});
});

// Challenge a specific user
app.get('/challenge', function(req, res){
	bot.send("/challenge " + req.query.user + ", randombattle", null);
	res.redirect("/");
});

// Challenging control
app.get('/startchallenging', function(req, res){
	CHALLENGING = true;
	res.redirect("/");
});
app.get('/endchallenging', function(req, res){
	CHALLENGING = false;
	res.redirect("/");
});

app.get('/room', function(req, res){
	if(bot.ROOMS[req.query.id]) {
		res.render("room.html", {
			game: bot.ROOMS[req.query.id],
			stringify : JSON.stringify,
			format: function(str) {
				return str.replace(/\n/g, "<br>").replace(/\t/g, "&nbsp;&nbsp;&nbsp;&nbsp;");
			}
		});
	} else {
		res.redirect("/");
	}
});

app.get('/replay', function(req, res){
	db.findOne({ id: req.query.id }).exec(function(err, game) {
		if(!game) {
			res.redirect("/");
			return;
		}

		game.decisions = JSON.parse(game.decisions);
		res.render('replay.html', {
			game : game,
			stringify : JSON.stringify
		});
	});
});

app.get('/search', function(req, res){
	logger.debug("Asked to query from web console.");
	bot.searchBattle();
	res.redirect("/");
});

var port = parseInt(program.port);
app.listen(port);
logger.info("Started web console on port " + port + "...");

module.exports = app;