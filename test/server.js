var path = require('path');
var assert = require('assert');

describe("Connect to wrong email server", function() {
	var emailModulePath = require.resolve(path.join(__dirname, '..', 'email'));
	var email;

	beforeEach(function() {
		if (require.cache[emailModulePath]) {
			delete require.cache[emailModulePath];
		}
		email = require('../email');
	});

	it("Should not call callback multiple times with wrong server configuration", function(done) {
		this.timeout(5000);
		var server = email.server.connect({ host: "bar.baz" });
		server.send({
			from: "foo@bar.baz",
			to: "foo@bar.baz",
			subject: "hello world",
			text: "hello world",
		}, function(err) {
			assert.notEqual(err, null);
			done();
		});
	});

});

