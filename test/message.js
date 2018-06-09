describe('messages', function() {
	const { simpleParser: parser } = require('mailparser');
	const { SMTPServer: smtpServer } = require('smtp-server');
	const { expect } = require('chai');
	const fs = require('fs');
	const path = require('path');
	const email = require('../email');
	const port = 2526;

	let server = null;
	let smtp = null;

	const send = function(message, verify, done) {
		smtp.onData = function(stream, session, callback) {
			//stream.pipe(process.stdout);
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

	it('simple text message', function(done) {
		var message = {
			subject: 'this is a test TEXT message from emailjs',
			from: 'zelda@gmail.com',
			to: 'gannon@gmail.com',
			text: 'hello friend, i hope this message finds you well.',
			'message-id': 'this is a special id',
		};

		send(
			email.message.create(message),
			function(mail) {
				expect(mail.text).to.equal(message.text + '\n\n\n');
				expect(mail.subject).to.equal(message.subject);
				expect(mail.from.text).to.equal(message.from);
				expect(mail.to.text).to.equal(message.to);
				expect(mail.messageId).to.equal('<' + message['message-id'] + '>');
			},
			done
		);
	});

	it('null text', function(done) {
		send(
			{
				subject: 'this is a test TEXT message from emailjs',
				from: 'zelda@gmail.com',
				to: 'gannon@gmail.com',
				text: null,
				'message-id': 'this is a special id',
			},
			function(mail) {
				expect(mail.text).to.equal('\n\n\n');
			},
			done
		);
	});

	it('empty text', function(done) {
		send(
			{
				subject: 'this is a test TEXT message from emailjs',
				from: 'zelda@gmail.com',
				to: 'gannon@gmail.com',
				text: '',
				'message-id': 'this is a special id',
			},
			function(mail) {
				expect(mail.text).to.equal('\n\n\n');
			},
			done
		);
	});

	it('simple unicode text message', function(done) {
		var message = {
			subject: 'this ✓ is a test ✓ TEXT message from emailjs',
			from: 'zelda✓ <zelda@gmail.com>',
			to: 'gannon✓ <gannon@gmail.com>',
			text: 'hello ✓ friend, i hope this message finds you well.',
		};

		send(
			email.message.create(message),
			function(mail) {
				expect(mail.text).to.equal(message.text + '\n\n\n');
				expect(mail.subject).to.equal(message.subject);
				expect(mail.from.text).to.equal(message.from);
				expect(mail.to.text).to.equal(message.to);
			},
			done
		);
	});

	it('very large text message', function(done) {
		this.timeout(20000);
		// thanks to jart+loberstech for this one!
		var message = {
			subject: 'this is a test TEXT message from emailjs',
			from: 'ninjas@gmail.com',
			to: 'pirates@gmail.com',
			text: fs.readFileSync(
				path.join(__dirname, 'attachments/smtp.txt'),
				'utf-8'
			),
		};

		send(
			email.message.create(message),
			function(mail) {
				expect(mail.text).to.equal(message.text.replace(/\r/g, '') + '\n\n\n');
				expect(mail.subject).to.equal(message.subject);
				expect(mail.from.text).to.equal(message.from);
				expect(mail.to.text).to.equal(message.to);
			},
			done
		);
	});

	it('very large text data', function(done) {
		this.timeout(10000);
		var text =
			'<html><body><pre>' +
			fs.readFileSync(path.join(__dirname, 'attachments/smtp.txt'), 'utf-8') +
			'</pre></body></html>';
		var message = {
			subject: 'this is a test TEXT+DATA message from emailjs',
			from: 'lobsters@gmail.com',
			to: 'lizards@gmail.com',
			text:
				'hello friend if you are seeing this, you can not view html emails. it is attached inline.',
			attachment: { data: text, alternative: true },
		};

		send(
			message,
			function(mail) {
				expect(mail.html).to.equal(text.replace(/\r/g, ''));
				expect(mail.text).to.equal(message.text + '\n');
				expect(mail.subject).to.equal(message.subject);
				expect(mail.from.text).to.equal(message.from);
				expect(mail.to.text).to.equal(message.to);
			},
			done
		);
	});

	it('html data', function(done) {
		var html = fs.readFileSync(
			path.join(__dirname, 'attachments/smtp.html'),
			'utf-8'
		);
		var message = {
			subject: 'this is a test TEXT+HTML+DATA message from emailjs',
			from: 'obama@gmail.com',
			to: 'mitt@gmail.com',
			attachment: { data: html, alternative: true },
		};

		send(
			message,
			function(mail) {
				expect(mail.html).to.equal(html.replace(/\r/g, ''));
				expect(mail.text).to.equal('\n');
				expect(mail.subject).to.equal(message.subject);
				expect(mail.from.text).to.equal(message.from);
				expect(mail.to.text).to.equal(message.to);
			},
			done
		);
	});

	it('html file', function(done) {
		var html = fs.readFileSync(
			path.join(__dirname, 'attachments/smtp.html'),
			'utf-8'
		);
		var headers = {
			subject: 'this is a test TEXT+HTML+FILE message from emailjs',
			from: 'thomas@gmail.com',
			to: 'nikolas@gmail.com',
			attachment: {
				path: path.join(__dirname, 'attachments/smtp.html'),
				alternative: true,
			},
		};

		send(
			headers,
			function(mail) {
				expect(mail.html).to.equal(html.replace(/\r/g, ''));
				expect(mail.text).to.equal('\n');
				expect(mail.subject).to.equal(headers.subject);
				expect(mail.from.text).to.equal(headers.from);
				expect(mail.to.text).to.equal(headers.to);
			},
			done
		);
	});

	it('html with image embed', function(done) {
		var html = fs.readFileSync(
			path.join(__dirname, 'attachments/smtp2.html'),
			'utf-8'
		);
		var image = fs.readFileSync(path.join(__dirname, 'attachments/smtp.gif'));
		var headers = {
			subject: 'this is a test TEXT+HTML+IMAGE message from emailjs',
			from: 'ninja@gmail.com',
			to: 'pirate@gmail.com',
			attachment: {
				path: path.join(__dirname, 'attachments/smtp2.html'),
				alternative: true,
				related: [
					{
						path: path.join(__dirname, 'attachments/smtp.gif'),
						type: 'image/gif',
						name: 'smtp-diagram.gif',
						headers: { 'Content-ID': '<smtp-diagram@local>' },
					},
				],
			},
		};

		send(
			headers,
			function(mail) {
				expect(mail.attachments[0].content.toString('base64')).to.equal(
					image.toString('base64')
				);
				expect(mail.html).to.equal(html.replace(/\r/g, ''));
				expect(mail.text).to.equal('\n');
				expect(mail.subject).to.equal(headers.subject);
				expect(mail.from.text).to.equal(headers.from);
				expect(mail.to.text).to.equal(headers.to);
			},
			done
		);
	});

	it('html data and attachment', function(done) {
		var html = fs.readFileSync(
			path.join(__dirname, 'attachments/smtp.html'),
			'utf-8'
		);
		var headers = {
			subject: 'this is a test TEXT+HTML+FILE message from emailjs',
			from: 'thomas@gmail.com',
			to: 'nikolas@gmail.com',
			attachment: [
				{
					path: path.join(__dirname, 'attachments/smtp.html'),
					alternative: true,
				},
				{ path: path.join(__dirname, 'attachments/smtp.gif') },
			],
		};

		send(
			headers,
			function(mail) {
				expect(mail.html).to.equal(html.replace(/\r/g, ''));
				expect(mail.text).to.equal('\n');
				expect(mail.subject).to.equal(headers.subject);
				expect(mail.from.text).to.equal(headers.from);
				expect(mail.to.text).to.equal(headers.to);
			},
			done
		);
	});

	it('attachment', function(done) {
		var pdf = fs.readFileSync(path.join(__dirname, 'attachments/smtp.pdf'));
		var headers = {
			subject: 'this is a test TEXT+ATTACHMENT message from emailjs',
			from: 'washing@gmail.com',
			to: 'lincoln@gmail.com',
			text: 'hello friend, i hope this message and pdf finds you well.',
			attachment: {
				path: path.join(__dirname, 'attachments/smtp.pdf'),
				type: 'application/pdf',
				name: 'smtp-info.pdf',
			},
		};

		send(
			headers,
			function(mail) {
				expect(mail.attachments[0].content.toString('base64')).to.equal(
					pdf.toString('base64')
				);
				expect(mail.text).to.equal(headers.text + '\n');
				expect(mail.subject).to.equal(headers.subject);
				expect(mail.from.text).to.equal(headers.from);
				expect(mail.to.text).to.equal(headers.to);
			},
			done
		);
	});

	it('attachment sent with unicode filename', function(done) {
		var pdf = fs.readFileSync(path.join(__dirname, 'attachments/smtp.pdf'));
		var headers = {
			subject: 'this is a test TEXT+ATTACHMENT message from emailjs',
			from: 'washing@gmail.com',
			to: 'lincoln@gmail.com',
			text: 'hello friend, i hope this message and pdf finds you well.',
			attachment: {
				path: path.join(__dirname, 'attachments/smtp.pdf'),
				type: 'application/pdf',
				name: 'smtp-✓-info.pdf',
			},
		};

		send(
			headers,
			function(mail) {
				expect(mail.attachments[0].content.toString('base64')).to.equal(
					pdf.toString('base64')
				);
				expect(mail.attachments[0].filename).to.equal('smtp-✓-info.pdf');
				expect(mail.text).to.equal(headers.text + '\n');
				expect(mail.subject).to.equal(headers.subject);
				expect(mail.from.text).to.equal(headers.from);
				expect(mail.to.text).to.equal(headers.to);
			},
			done
		);
	});

	it('attachments', function(done) {
		var pdf = fs.readFileSync(path.join(__dirname, 'attachments/smtp.pdf'));
		var tar = fs.readFileSync(
			path.join(__dirname, 'attachments/postfix-2.8.7.tar.gz')
		);
		var headers = {
			subject: 'this is a test TEXT+2+ATTACHMENTS message from emailjs',
			from: 'sergey@gmail.com',
			to: 'jobs@gmail.com',
			text: 'hello friend, i hope this message and attachments finds you well.',
			attachment: [
				{
					path: path.join(__dirname, 'attachments/smtp.pdf'),
					type: 'application/pdf',
					name: 'smtp-info.pdf',
				},
				{
					path: path.join(__dirname, 'attachments/postfix-2.8.7.tar.gz'),
					type: 'application/tar-gz',
					name: 'postfix.source.2.8.7.tar.gz',
				},
			],
		};

		send(
			headers,
			function(mail) {
				expect(mail.attachments[0].content.toString('base64')).to.equal(
					pdf.toString('base64')
				);
				expect(mail.attachments[1].content.toString('base64')).to.equal(
					tar.toString('base64')
				);
				expect(mail.text).to.equal(headers.text + '\n');
				expect(mail.subject).to.equal(headers.subject);
				expect(mail.from.text).to.equal(headers.from);
				expect(mail.to.text).to.equal(headers.to);
			},
			done
		);
	});

	it('streams', function(done) {
		var pdf = fs.readFileSync(path.join(__dirname, 'attachments/smtp.pdf'));
		var tar = fs.readFileSync(
			path.join(__dirname, 'attachments/postfix-2.8.7.tar.gz')
		);
		var stream = fs.createReadStream(
			path.join(__dirname, 'attachments/smtp.pdf')
		);
		var stream2 = fs.createReadStream(
			path.join(__dirname, 'attachments/postfix-2.8.7.tar.gz')
		);
		var headers = {
			subject:
				'this is a test TEXT+2+STREAMED+ATTACHMENTS message from emailjs',
			from: 'stanford@gmail.com',
			to: 'mit@gmail.com',
			text:
				'hello friend, i hope this message and streamed attachments finds you well.',
			attachment: [
				{ stream: stream, type: 'application/pdf', name: 'smtp-info.pdf' },
				{
					stream: stream2,
					type: 'application/x-gzip',
					name: 'postfix.source.2.8.7.tar.gz',
				},
			],
		};

		stream.pause();
		stream2.pause();

		send(
			headers,
			function(mail) {
				expect(mail.attachments[0].content.toString('base64')).to.equal(
					pdf.toString('base64')
				);
				expect(mail.attachments[1].content.toString('base64')).to.equal(
					tar.toString('base64')
				);
				expect(mail.text).to.equal(headers.text + '\n');
				expect(mail.subject).to.equal(headers.subject);
				expect(mail.from.text).to.equal(headers.from);
				expect(mail.to.text).to.equal(headers.to);
			},
			done
		);
	});
});
