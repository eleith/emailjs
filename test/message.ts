import { readFileSync, createReadStream } from 'fs';
import { join } from 'path';

import test, { CbExecutionContext } from 'ava';
import { simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';

import { SMTPClient, Message, MessageAttachment } from '../email';

type UnPromisify<T> = T extends Promise<infer U> ? U : T;

let port = 4000;

function send(
	t: CbExecutionContext,
	message: Message,
	verify: (mail: UnPromisify<ReturnType<typeof simpleParser>>) => void
) {
	const server = new SMTPServer({
		secure: true,
		onAuth(auth, _session, callback) {
			if (auth.username == 'pooh' && auth.password == 'honey') {
				callback(null, { user: 'pooh' });
			} else {
				return callback(new Error('invalid user / pass'));
			}
		},
		onData(stream, _session, callback: () => void) {
			simpleParser(stream, {
				skipHtmlToText: true,
				skipTextToHtml: true,
				skipImageLinks: true,
			} as Record<string, unknown>).then(verify);
			stream.on('end', callback);
		},
	});
	const p = port++;
	server.listen(p, () => {
		new SMTPClient({
			port: p,
			user: 'pooh',
			password: 'honey',
			ssl: true,
		}).send(message, (err) => {
			server.close();
			t.end(err);
		});
	});
}

test.cb('simple text message', (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'zelda@gmail.com',
		to: 'gannon@gmail.com',
		cc: 'gannon@gmail.com',
		bcc: 'gannon@gmail.com',
		text: 'hello friend, i hope this message finds you well.',
		'message-id': 'this is a special id',
	};

	send(t, new Message(msg), (mail) => {
		t.is(mail.text, msg.text + '\n\n\n');
		t.is(mail.subject, msg.subject);
		t.is(mail.from?.text, msg.from);
		t.is(mail.to?.text, msg.to);
		t.is(mail.messageId, '<' + msg['message-id'] + '>');
	});
});

test.cb('null text message', (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'zelda@gmail.com',
		to: 'gannon@gmail.com',
		text: null,
		'message-id': 'this is a special id',
	};

	send(t, new Message(msg), (mail) => {
		t.is(mail.text, '\n\n\n');
	});
});

test.cb('empty text message', (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'zelda@gmail.com',
		to: 'gannon@gmail.com',
		text: '',
		'message-id': 'this is a special id',
	};

	send(t, new Message(msg), (mail) => {
		t.is(mail.text, '\n\n\n');
	});
});

test.cb('simple unicode text message', (t) => {
	const msg = {
		subject: 'this ✓ is a test ✓ TEXT message from emailjs',
		from: 'zelda✓ <zelda@gmail.com>',
		to: 'gannon✓ <gannon@gmail.com>',
		text: 'hello ✓ friend, i hope this message finds you well.',
	};

	send(t, new Message(msg), (mail) => {
		t.is(mail.text, msg.text + '\n\n\n');
		t.is(mail.subject, msg.subject);
		t.is(mail.from?.text, msg.from);
		t.is(mail.to?.text, msg.to);
	});
});

test.cb('very large text message', (t) => {
	// thanks to jart+loberstech for this one!
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'ninjas@gmail.com',
		to: 'pirates@gmail.com',
		text: readFileSync(join(__dirname, 'attachments/smtp.txt'), 'utf-8'),
	};

	send(t, new Message(msg), (mail) => {
		t.is(mail.text, msg.text.replace(/\r/g, '') + '\n\n\n');
		t.is(mail.subject, msg.subject);
		t.is(mail.from?.text, msg.from);
		t.is(mail.to?.text, msg.to);
	});
});

test.cb('very large text data message', (t) => {
	const text =
		'<html><body><pre>' +
		readFileSync(join(__dirname, 'attachments/smtp.txt'), 'utf-8') +
		'</pre></body></html>';

	const msg = {
		subject: 'this is a test TEXT+DATA message from emailjs',
		from: 'lobsters@gmail.com',
		to: 'lizards@gmail.com',
		text:
			'hello friend if you are seeing this, you can not view html emails. it is attached inline.',
		attachment: {
			data: text,
			alternative: true,
		},
	};

	send(t, new Message(msg), (mail) => {
		t.is(mail.html, text.replace(/\r/g, ''));
		t.is(mail.text, msg.text + '\n');
		t.is(mail.subject, msg.subject);
		t.is(mail.from?.text, msg.from);
		t.is(mail.to?.text, msg.to);
	});
});

test.cb('html data message', (t) => {
	const html = readFileSync(join(__dirname, 'attachments/smtp.html'), 'utf-8');
	const msg = {
		subject: 'this is a test TEXT+HTML+DATA message from emailjs',
		from: 'obama@gmail.com',
		to: 'mitt@gmail.com',
		attachment: {
			data: html,
			alternative: true,
		},
	};

	send(t, new Message(msg), (mail) => {
		t.is(mail.html, html.replace(/\r/g, ''));
		t.is(mail.text, '\n');
		t.is(mail.subject, msg.subject);
		t.is(mail.from?.text, msg.from);
		t.is(mail.to?.text, msg.to);
	});
});

test.cb('html file message', (t) => {
	const html = readFileSync(join(__dirname, 'attachments/smtp.html'), 'utf-8');
	const msg = {
		subject: 'this is a test TEXT+HTML+FILE message from emailjs',
		from: 'thomas@gmail.com',
		to: 'nikolas@gmail.com',
		attachment: {
			path: join(__dirname, 'attachments/smtp.html'),
			alternative: true,
		},
	};

	send(t, new Message(msg), (mail) => {
		t.is(mail.html, html.replace(/\r/g, ''));
		t.is(mail.text, '\n');
		t.is(mail.subject, msg.subject);
		t.is(mail.from?.text, msg.from);
		t.is(mail.to?.text, msg.to);
	});
});

test.cb('html with image embed message', (t) => {
	const html = readFileSync(join(__dirname, 'attachments/smtp2.html'), 'utf-8');
	const image = readFileSync(join(__dirname, 'attachments/smtp.gif'));
	const msg = {
		subject: 'this is a test TEXT+HTML+IMAGE message from emailjs',
		from: 'ninja@gmail.com',
		to: 'pirate@gmail.com',
		attachment: {
			path: join(__dirname, 'attachments/smtp2.html'),
			alternative: true,
			related: [
				{
					path: join(__dirname, 'attachments/smtp.gif'),
					type: 'image/gif',
					name: 'smtp-diagram.gif',
					headers: { 'Content-ID': '<smtp-diagram@local>' },
				},
			],
		},
	};

	send(t, new Message(msg), (mail) => {
		t.is(
			mail.attachments[0].content.toString('base64'),
			image.toString('base64')
		);
		t.is(mail.html, html.replace(/\r/g, ''));
		t.is(mail.text, '\n');
		t.is(mail.subject, msg.subject);
		t.is(mail.from?.text, msg.from);
		t.is(mail.to?.text, msg.to);
	});
});

test.cb('html data and attachment message', (t) => {
	const html = readFileSync(join(__dirname, 'attachments/smtp.html'), 'utf-8');
	const msg = {
		subject: 'this is a test TEXT+HTML+FILE message from emailjs',
		from: 'thomas@gmail.com',
		to: 'nikolas@gmail.com',
		attachment: [
			{ path: join(__dirname, 'attachments/smtp.html'), alternative: true },
			{ path: join(__dirname, 'attachments/smtp.gif') },
		] as MessageAttachment[],
	};

	send(t, new Message(msg), (mail) => {
		t.is(mail.html, html.replace(/\r/g, ''));
		t.is(mail.text, '\n');
		t.is(mail.subject, msg.subject);
		t.is(mail.from?.text, msg.from);
		t.is(mail.to?.text, msg.to);
	});
});

test.cb('attachment message', (t) => {
	const pdf = readFileSync(join(__dirname, 'attachments/smtp.pdf'));
	const msg = {
		subject: 'this is a test TEXT+ATTACHMENT message from emailjs',
		from: 'washing@gmail.com',
		to: 'lincoln@gmail.com',
		text: 'hello friend, i hope this message and pdf finds you well.',
		attachment: {
			path: join(__dirname, 'attachments/smtp.pdf'),
			type: 'application/pdf',
			name: 'smtp-info.pdf',
		} as MessageAttachment,
	};

	send(t, new Message(msg), (mail) => {
		t.is(
			mail.attachments[0].content.toString('base64'),
			pdf.toString('base64')
		);
		t.is(mail.text, msg.text + '\n');
		t.is(mail.subject, msg.subject);
		t.is(mail.from?.text, msg.from);
		t.is(mail.to?.text, msg.to);
	});
});

test.cb('attachment sent with unicode filename message', (t) => {
	const pdf = readFileSync(join(__dirname, 'attachments/smtp.pdf'));
	const msg = {
		subject: 'this is a test TEXT+ATTACHMENT message from emailjs',
		from: 'washing@gmail.com',
		to: 'lincoln@gmail.com',
		text: 'hello friend, i hope this message and pdf finds you well.',
		attachment: {
			path: join(__dirname, 'attachments/smtp.pdf'),
			type: 'application/pdf',
			name: 'smtp-✓-info.pdf',
		} as MessageAttachment,
	};

	send(t, new Message(msg), (mail) => {
		t.is(
			mail.attachments[0].content.toString('base64'),
			pdf.toString('base64')
		);
		t.is(mail.attachments[0].filename, 'smtp-✓-info.pdf');
		t.is(mail.text, msg.text + '\n');
		t.is(mail.subject, msg.subject);
		t.is(mail.from?.text, msg.from);
		t.is(mail.to?.text, msg.to);
	});
});

test.cb('attachments message', (t) => {
	const pdf = readFileSync(join(__dirname, 'attachments/smtp.pdf'));
	const tar = readFileSync(join(__dirname, 'attachments/postfix-2.8.7.tar.gz'));
	const msg = {
		subject: 'this is a test TEXT+2+ATTACHMENTS message from emailjs',
		from: 'sergey@gmail.com',
		to: 'jobs@gmail.com',
		text: 'hello friend, i hope this message and attachments finds you well.',
		attachment: [
			{
				path: join(__dirname, 'attachments/smtp.pdf'),
				type: 'application/pdf',
				name: 'smtp-info.pdf',
			},
			{
				path: join(__dirname, 'attachments/postfix-2.8.7.tar.gz'),
				type: 'application/tar-gz',
				name: 'postfix.source.2.8.7.tar.gz',
			},
		] as MessageAttachment[],
	};

	send(t, new Message(msg), (mail) => {
		t.is(
			mail.attachments[0].content.toString('base64'),
			pdf.toString('base64')
		);
		t.is(
			mail.attachments[1].content.toString('base64'),
			tar.toString('base64')
		);
		t.is(mail.text, msg.text + '\n');
		t.is(mail.subject, msg.subject);
		t.is(mail.from?.text, msg.from);
		t.is(mail.to?.text, msg.to);
	});
});

test.cb('streams message', (t) => {
	const pdf = readFileSync(join(__dirname, 'attachments/smtp.pdf'));
	const tar = readFileSync(join(__dirname, 'attachments/postfix-2.8.7.tar.gz'));
	const stream = createReadStream(join(__dirname, 'attachments/smtp.pdf'));
	const stream2 = createReadStream(
		join(__dirname, 'attachments/postfix-2.8.7.tar.gz')
	);

	const msg = {
		subject: 'this is a test TEXT+2+STREAMED+ATTACHMENTS message from emailjs',
		from: 'stanford@gmail.com',
		to: 'mit@gmail.com',
		text:
			'hello friend, i hope this message and streamed attachments finds you well.',
		attachment: [
			{ stream, type: 'application/pdf', name: 'smtp-info.pdf' },
			{
				stream: stream2,
				type: 'application/x-gzip',
				name: 'postfix.source.2.8.7.tar.gz',
			},
		],
	};

	stream.pause();
	stream2.pause();

	send(t, new Message(msg), (mail) => {
		t.is(
			mail.attachments[0].content.toString('base64'),
			pdf.toString('base64')
		);
		t.is(
			mail.attachments[1].content.toString('base64'),
			tar.toString('base64')
		);
		t.is(mail.text, msg.text + '\n');
		t.is(mail.subject, msg.subject);
		t.is(mail.from?.text, msg.from);
		t.is(mail.to?.text, msg.to);
	});
});

test.cb('message validation fails without `from` header', (t) => {
	const msg = new Message({});
	msg.valid((isValid, reason) => {
		t.false(isValid);
		t.is(reason, 'Message must have a `from` header');
		t.end();
	});
});

test.cb('message validation fails without `to`, `cc`, or `bcc` header', (t) => {
	const msg = new Message({
		from: 'piglet@gmail.com',
	});
	msg.valid((isValid, reason) => {
		t.false(isValid);
		t.is(reason, 'Message must have at least one `to`, `cc`, or `bcc` header');
		t.end();
	});
});

test.cb(
	'message validation succeeds with only `to` recipient header (string)',
	(t) => {
		const msg = new Message({
			from: 'piglet@gmail.com',
			to: 'pooh@gmail.com',
		});
		msg.valid((isValid) => {
			t.true(isValid);
			t.end();
		});
	}
);

test.cb(
	'message validation succeeds with only `to` recipient header (array)',
	(t) => {
		const msg = new Message({
			from: 'piglet@gmail.com',
			to: ['pooh@gmail.com'],
		});
		msg.header.to = [msg.header.to as string];
		msg.header.cc = [];
		msg.header.bcc = [];
		msg.valid((isValid) => {
			t.true(isValid);
			t.end();
		});
	}
);

test.cb(
	'message validation succeeds with only `cc` recipient header (string)',
	(t) => {
		const msg = new Message({
			from: 'piglet@gmail.com',
			cc: 'pooh@gmail.com',
		});
		msg.valid((isValid) => {
			t.true(isValid);
			t.end();
		});
	}
);

test.cb(
	'message validation succeeds with only `cc` recipient header (array)',
	(t) => {
		const msg = new Message({
			from: 'piglet@gmail.com',
			cc: ['pooh@gmail.com'],
		});
		msg.header.to = [];
		msg.header.cc = [msg.header.cc as string];
		msg.header.bcc = [];
		msg.valid((isValid) => {
			t.true(isValid);
			t.end();
		});
	}
);

test.cb(
	'message validation succeeds with only `bcc` recipient header (string)',
	(t) => {
		const msg = new Message({
			from: 'piglet@gmail.com',
			bcc: 'pooh@gmail.com',
		});
		msg.valid((isValid) => {
			t.true(isValid);
			t.end();
		});
	}
);

test.cb(
	'message validation succeeds with only `bcc` recipient header (array)',
	(t) => {
		const msg = new Message({
			from: 'piglet@gmail.com',
			bcc: ['pooh@gmail.com'],
		});
		msg.header.to = [];
		msg.header.cc = [];
		msg.header.bcc = [msg.header.bcc as string];
		msg.valid((isValid) => {
			t.true(isValid);
			t.end();
		});
	}
);
