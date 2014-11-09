var Datastore = require('nedb');

var db = new Datastore({ filename: 'results.db', autoload: true });
module.exports = db;