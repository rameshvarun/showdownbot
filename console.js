var express = require('express');
var app = express();
var nunjucks = require('nunjucks');
var bot = require('./bot')
var program = require('commander');

// Results database
var db = require("./db");

var _ = require("underscore")

// Setup Logging
var log4js = require('log4js');
var logger = require('log4js').getLogger("webconsole");
log4js.addAppender(log4js.appenders.file('logs/webconsole.log'), 'webconsole');

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
			"history" : history
		});
	});
});

app.get('/replay', function(req, res){
	db.findOne({ id: req.query.id }).exec(function(err, game) {
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