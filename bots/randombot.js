/* Randombot - to be used primarily for testing
Can also be used as a fallback, in case another decision algorithm
fails or crashes */

var _ = require("underscore");

var decide = module.exports.decide = function(battle, choices) {
    return _.shuffle(choices)[0];
};