/**
 * @param {Date} [date] an optional date to convert to RFC2822 format
 * @param {boolean} [useUtc] whether to parse the date as UTC (default: false)
 * @returns {string} the converted date
 */
export function getRFC2822Date(date = new Date(), useUtc = false) {
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

/**
 * @param {Date} [date] an optional date to convert to RFC2822 format (UTC)
 * @returns {string} the converted date
 */
export function getRFC2822DateUTC(date = new Date()) {
	const dates = date.toUTCString().split(' ');
	dates.pop(); // remove timezone
	dates.push('+0000');
	return dates.join(' ');
}

/**
 * RFC 2822 regex
 * @see https://tools.ietf.org/html/rfc2822#section-3.3
 * @see https://github.com/moment/moment/blob/a831fc7e2694281ce31e4f090bbcf90a690f0277/src/lib/create/from-string.js#L101
 */
const rfc2822re =
	/^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s)?(\d{1,2})\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s(\d{2,4})\s(\d\d):(\d\d)(?::(\d\d))?\s(?:(UT|GMT|[ECMP][SD]T)|([Zz])|([+-]\d{4}))$/.compile();

/**
 * @param {string} [date] a string to check for conformance to the [rfc2822](https://tools.ietf.org/html/rfc2822#section-3.3) standard
 * @returns {boolean} the result of the conformance check
 */
export function isRFC2822Date(date: string) {
	return rfc2822re.test(date);
}
