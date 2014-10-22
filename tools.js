module.exports.safeJSON = function(data) {
	if (data.length < 1) return;
	if (data[0] == ']') data = data.substr(1);
	return JSON.parse(data);
}

module.exports.toRoomid = function(roomid) {
	return roomid.replace(/[^a-zA-Z0-9-]+/g, '');
}