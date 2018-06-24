describe('rfc2822 dates', function() {
	const { expect } = require('chai');
	const {
		date: { getRFC2822Date, getRFC2822DateUTC },
	} = require('../email');

	var d_utc = dt => getRFC2822DateUTC(new Date(dt));
	var d = (dt, utc = false) => getRFC2822Date(new Date(dt), utc);

	it('should match standard regex', function(done) {
		// RFC 2822 regex: For details see https://tools.ietf.org/html/rfc2822#section-3.3
		// thanks to moment.js for the listing: https://github.com/moment/moment/blob/a831fc7e2694281ce31e4f090bbcf90a690f0277/src/lib/create/from-string.js#L101
		var rfc2822re = /^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s)?(\d{1,2})\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s(\d{2,4})\s(\d\d):(\d\d)(?::(\d\d))?\s(?:(UT|GMT|[ECMP][SD]T)|([Zz])|([+-]\d{4}))$/;
		expect(d(0)).to.match(rfc2822re);
		expect(d(329629726785)).to.match(rfc2822re);
		expect(d(729629726785)).to.match(rfc2822re);
		expect(d(1129629726785)).to.match(rfc2822re);
		expect(d(1529629726785)).to.match(rfc2822re);

		done();
	});

	it('should produce proper UTC dates', function(done) {
		expect(d_utc(0)).to.equal('Thu, 01 Jan 1970 00:00:00 +0000');
		expect(d_utc(0)).to.equal(d(0, true));

		expect(d_utc(329629726785)).to.equal('Thu, 12 Jun 1980 03:48:46 +0000');
		expect(d_utc(329629726785)).to.equal(d(329629726785, true));

		expect(d_utc(729629726785)).to.equal('Sat, 13 Feb 1993 18:55:26 +0000');
		expect(d_utc(729629726785)).to.equal(d(729629726785, true));

		expect(d_utc(1129629726785)).to.equal('Tue, 18 Oct 2005 10:02:06 +0000');
		expect(d_utc(1129629726785)).to.equal(d(1129629726785, true));

		expect(d_utc(1529629726785)).to.equal('Fri, 22 Jun 2018 01:08:46 +0000');
		expect(d_utc(1529629726785)).to.equal(d(1529629726785, true));

		done();
	});
});
