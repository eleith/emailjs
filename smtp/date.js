function getRFC2822Date(date = new Date(), useUtc = false) {
	if (useUtc) {
		return getRFC2822DateUTC(date);
	}

	const dates = date
		.toString()
		.replace('GMT', '')
		.replace(/\s\(.*\)$/, '')
		.split(' ');

	dates[0] = dates[0] + ',';

	const day = dates[1];
	dates[1] = dates[2];
	dates[2] = day;

	return dates.join(' ');
}

function getRFC2822DateUTC(date = new Date()) {
	const dates = date.toUTCString().split(' ');
	dates.pop(); // remove timezone
	dates.push('+0000');
	return dates.join(' ');
}

exports.getRFC2822Date = getRFC2822Date;
exports.getRFC2822DateUTC = getRFC2822DateUTC;
