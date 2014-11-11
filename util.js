// Some Pokemon Showdown-specific JSON parsing rules
module.exports.safeJSON = function(data) {
	if (data.length < 1) return;
	if (data[0] == ']') data = data.substr(1);
	return JSON.parse(data);
}

// Sanitizes a Room name
module.exports.toRoomid = function(roomid) {
	return roomid.replace(/[^a-zA-Z0-9-]+/g, '');
}

// Unsure exactly - sanitizes roomType?
module.exports.toId = function(text) {
	text = text || '';
	if (typeof text === 'number') text = ''+text;
	if (typeof text !== 'string') return toId(text && text.id);
	return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
