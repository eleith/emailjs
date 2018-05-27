const path = require('path');
const assert = require('assert');

describe('Connect to wrong email server', function() {
	const emailModulePath = require.resolve(path.join(__dirname, '..', 'email'));
	let email;

	beforeEach(function() {
		if (require.cache[emailModulePath]) {
			delete require.cache[emailModulePath];
		}
		email = require('../email');
	});

	it('Should not call callback multiple times with wrong server configuration', function(done) {
		this.timeout(5000);
		const server = email.server.connect({ host: 'bar.baz' });
		server.send(
			{
				from: 'foo@bar.baz',
				to: 'foo@bar.baz',
				subject: 'hello world',
				text: 'hello world',
			},
			function(err) {
				assert.notEqual(err, null);
				done();
			}
		);
	});
});
