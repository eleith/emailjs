const path = require('path');
const assert = require('assert');

describe('Connect to wrong email server', function() {
	const emailModulePath = require.resolve(path.join(__dirname, '..', 'email'));

	beforeEach(function() {
		if (require.cache[emailModulePath]) {
			delete require.cache[emailModulePath];
		}
	});

	it('Should not call callback multiple times with wrong server configuration', function(done) {
		this.timeout(5000);
		const server = require(emailModulePath).server.connect({ host: 'bar.baz' });
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

	it('should have a default timeout', function(done) {
		const connectionOptions = {
			user: "username",
			password: "password",
			host: "127.0.0.1",
			port: 1234,
		};

		assert.strictEqual(email.server.connect(connectionOptions).smtp.timeout, email.SMTP.DEFAULT_TIMEOUT);

		connectionOptions.timeout = null;
		assert.strictEqual(email.server.connect(connectionOptions).smtp.timeout, email.SMTP.DEFAULT_TIMEOUT);

		connectionOptions.timeout = undefined;
		assert.strictEqual(email.server.connect(connectionOptions).smtp.timeout, email.SMTP.DEFAULT_TIMEOUT);

		done();
	});
});
