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

	it('rfc2822 date', function(done) {
		var d_utc = dt => email.message.getRFC2822DateUTC(new Date(dt));
		var d = (dt, utc = false) =>
			email.message.getRFC2822Date(new Date(dt), utc);

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

		// travis always returns 0 as the timezone offset,
		// so we hardcode offsets against -0800/-0700 timestamps
		// (entirely because that corresponds with the timezone i'm currently in)
		// pretty brittle; going to look at moment.js' tests and see if there's something i can pull
		var useOffset = new Date().getTimezoneOffset() === 0;
		const d_short = (dt, use0800 = true) => {
			return d(dt + (useOffset ? (use0800 ? -28800000 : -25200000) : 0))
				.split(' ')
				.slice(0, 5)
				.join(' ');
		};

		expect(d_short(0)).to.equal('Wed, 31 Dec 1969 16:00:00');
		expect(d_short(329629726785, false)).to.equal('Wed, 11 Jun 1980 20:48:46');
		expect(d_short(729629726785)).to.equal('Sat, 13 Feb 1993 10:55:26');
		expect(d_short(1129629726785, false)).to.equal('Tue, 18 Oct 2005 03:02:06');
		expect(d_short(1529629726785, false)).to.equal('Thu, 21 Jun 2018 18:08:46');

		done();
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
