import test from 'ava';
import { getRFC2822Date, getRFC2822DateUTC, isRFC2822Date } from '../email.js';

const toD_utc = (dt: number) => getRFC2822DateUTC(new Date(dt));
const toD = (dt: number, utc = false) => getRFC2822Date(new Date(dt), utc);

test('rfc2822 non-UTC', async (t) => {
	t.true(isRFC2822Date(toD(0)));
	t.true(isRFC2822Date(toD(329629726785)));
	t.true(isRFC2822Date(toD(729629726785)));
	t.true(isRFC2822Date(toD(1129629726785)));
	t.true(isRFC2822Date(toD(1529629726785)));
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
