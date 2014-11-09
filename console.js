var express = require('express');
var app = express();
var nunjucks = require('nunjucks');
var bot = require('./bot')

// Results database
var db = require("./db");

var _ = require("underscore")

nunjucks.configure('templates', {
	autoescape: true,
	express: app,
	watch: true
});

app.get('/', function(req, res){
	db.find({}).sort({ date: 1}).exec(function(err, history) {
		res.render('home.html', {
			"games" : _.values(bot.ROOMS),
			"domain" : bot.DOMAIN,
			"history" : history
		});
	});
});

app.get('/search', function(req, res){
	bot.searchBattle();
	res.redirect("/");
});

app.listen(3000);

module.exports = app;