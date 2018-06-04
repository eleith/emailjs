describe('authorize plain', function() {
	const { simpleParser: parser } = require('mailparser');
	const { SMTPServer: smtpServer } = require('smtp-server');
	const { expect } = require('chai');
	const email = require('../email');
	const port = 2526;

	let server = null;
	let smtp = null;

	const send = function(message, verify, done) {
		smtp.onData = function(stream, session, callback) {
			parser(stream)
				.then(verify)
				.then(done)
				.catch(done);
			stream.on('end', callback);
		};

		server.send(message, function(err) {
			if (err) {
				throw err;
			}
		});
	};

	before(function(done) {
		process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // prevent CERT_HAS_EXPIRED errors

		smtp = new smtpServer({ secure: true, authMethods: ['LOGIN'] });
		smtp.listen(port, function() {
			smtp.onAuth = function(auth, session, callback) {
				if (auth.username == 'pooh' && auth.password == 'honey') {
					callback(null, { user: 'pooh' });
				} else {
					return callback(new Error('invalid user / pass'));
				}
			};

			server = email.server.connect({
				port: port,
				user: 'pooh',
				password: 'honey',
				ssl: true,
			});

			done();
		});
	});

	after(function(done) {
		smtp.close(done);
	});

	it('login', function(done) {
		const message = {
			subject: 'this is a test TEXT message from emailjs',
			from: 'piglet@gmail.com',
			to: 'pooh@gmail.com',
			text: "It is hard to be brave when you're only a Very Small Animal.",
		};

		const created = email.message.create(message);

		const callback = function(mail) {
			expect(mail.text).to.equal(message.text + '\n\n\n');
			expect(mail.subject).to.equal(message.subject);
			expect(mail.from.text).to.equal(message.from);
			expect(mail.to.text).to.equal(message.to);
		};

		send(created, callback, done);
	});
});
