var express = require('express');
var app = express();
var nunjucks = require('nunjucks');
var bot = require('./bot')

var _ = require("underscore")

nunjucks.configure('templates', {
	autoescape: true,
	express: app,
	watch: true
});

app.get('/', function(req, res){
  res.render('home.html', {
  	"games" : _.values(bot.ROOMS),
  	"domain" : bot.DOMAIN
  });
});

app.listen(3000);

module.exports = app;