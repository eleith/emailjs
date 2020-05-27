import test from 'ava';

import { getRFC2822Date, getRFC2822DateUTC } from '../email';

const toD_utc = (dt: number) => getRFC2822DateUTC(new Date(dt));
const toD = (dt: number, utc = false) => getRFC2822Date(new Date(dt), utc);

test('rfc2822 non-UTC', async (t) => {
	// RFC 2822 regex: For details see https://tools.ietf.org/html/rfc2822#section-3.3
	// thanks to moment.js for the listing: https://github.com/moment/moment/blob/a831fc7e2694281ce31e4f090bbcf90a690f0277/src/lib/create/from-string.js#L101
	const rfc2822re = /^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s)?(\d{1,2})\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s(\d{2,4})\s(\d\d):(\d\d)(?::(\d\d))?\s(?:(UT|GMT|[ECMP][SD]T)|([Zz])|([+-]\d{4}))$/;
	t.regex(toD(0), rfc2822re);
	t.regex(toD(329629726785), rfc2822re);
	t.regex(toD(729629726785), rfc2822re);
	t.regex(toD(1129629726785), rfc2822re);
	t.regex(toD(1529629726785), rfc2822re);
});

test('rfc2822 UTC', async (t) => {
	t.is(toD_utc(0), 'Thu, 01 Jan 1970 00:00:00 +0000');
	t.is(toD_utc(0), toD(0, true));

	t.is(toD_utc(329629726785), 'Thu, 12 Jun 1980 03:48:46 +0000');
	t.is(toD_utc(329629726785), toD(329629726785, true));

	t.is(toD_utc(729629726785), 'Sat, 13 Feb 1993 18:55:26 +0000');
	t.is(toD_utc(729629726785), toD(729629726785, true));

	t.is(toD_utc(1129629726785), 'Tue, 18 Oct 2005 10:02:06 +0000');
	t.is(toD_utc(1129629726785), toD(1129629726785, true));

	t.is(toD_utc(1529629726785), 'Fri, 22 Jun 2018 01:08:46 +0000');
	t.is(toD_utc(1529629726785), toD(1529629726785, true));
});
