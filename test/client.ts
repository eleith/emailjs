import { promisify } from 'util';

import test from 'ava';
import { simpleParser } from 'mailparser';
import type { ParsedMail, AddressObject } from 'mailparser';
import { SMTPServer } from 'smtp-server';

import type { MessageHeaders } from '../email.js';
import {
	DEFAULT_TIMEOUT,
	SMTPClient,
	Message,
	isRFC2822Date,
} from '../email.js';

const parseMap = new Map<string, ParsedMail>();
const port = 3333;
let greylistPort = 4444;

const client = new SMTPClient({
	port,
	user: 'pooh',
	password: 'honey',
	ssl: true,
});
const server = new SMTPServer({
	secure: true,
	onAuth(auth, _session, callback) {
		if (auth.username === 'pooh' && auth.password === 'honey') {
			callback(null, { user: 'pooh' });
		} else {
			return callback(new Error('invalid user / pass'));
		}
	},
	async onData(stream, _session, callback: () => void) {
		const mail = await simpleParser(stream, {
			skipHtmlToText: true,
			skipTextToHtml: true,
			skipImageLinks: true,
		} as Record<string, unknown>);

		parseMap.set(mail.subject as string, mail);
		callback();
	},
});

async function send(headers: Partial<MessageHeaders>) {
	return new Promise<ParsedMail>((resolve, reject) => {
		client.send(new Message(headers), (err) => {
			if (err) {
				reject(err);
			} else {
				resolve(parseMap.get(headers.subject as string) as ParsedMail);
			}
		});
	});
}

test.before(async (t) => {
	server.listen(port, t.pass);
});
test.after(async (t) => {
	server.close(t.pass);
});

test('client invokes callback exactly once for invalid connection', async (t) => {
	const msg = {
		from: 'foo@bar.baz',
		to: 'foo@bar.baz',
		subject: 'hello world',
		text: 'hello world',
	};
	await t.notThrowsAsync(
		new Promise<void>((resolve, reject) => {
			let counter = 0;
			const invalidClient = new SMTPClient({ host: 'localhost' });
			const incrementCounter = () => {
				if (counter > 0) {
					reject();
				} else {
					counter++;
				}
			};
			invalidClient.send(new Message(msg), (err) => {
				if (err == null) {
					reject();
				} else {
					incrementCounter();
				}
			});
			// @ts-expect-error the error event is only accessible from the protected socket property
			invalidClient.smtp.sock.once('error', () => {
				if (counter === 1) {
					resolve();
				} else {
					reject();
				}
			});
		})
	);
});

test('client has a default connection timeout', async (t) => {
	const connectionOptions = {
		user: 'username',
		password: 'password',
		host: '127.0.0.1',
		port: 1234,
		timeout: undefined as number | null | undefined,
	};
	t.is(new SMTPClient(connectionOptions).smtp.timeout, DEFAULT_TIMEOUT);

	connectionOptions.timeout = null;
	t.is(new SMTPClient(connectionOptions).smtp.timeout, DEFAULT_TIMEOUT);

	connectionOptions.timeout = undefined;
	t.is(new SMTPClient(connectionOptions).smtp.timeout, DEFAULT_TIMEOUT);
});

test('client deduplicates recipients', async (t) => {
	const msg = {
		from: 'zelda@gmail.com',
		to: 'gannon@gmail.com',
		cc: 'gannon@gmail.com',
		bcc: 'gannon@gmail.com',
	};
	const stack = client.createMessageStack(new Message(msg));
	t.true(stack.to.length === 1);
	t.is(stack.to[0].address, 'gannon@gmail.com');
});

test('client accepts array recipients', async (t) => {
	const msg = new Message({
		from: 'zelda@gmail.com',
		to: ['gannon1@gmail.com'],
		cc: ['gannon2@gmail.com'],
		bcc: ['gannon3@gmail.com'],
	});

	msg.header.to = [msg.header.to as string];
	msg.header.cc = [msg.header.cc as string];
	msg.header.bcc = [msg.header.bcc as string];

	const { isValid } = msg.checkValidity();
	const stack = client.createMessageStack(msg);

	t.true(isValid);
	t.is(stack.to.length, 3);
	t.deepEqual(
		stack.to.map((x) => x.address),
		['gannon1@gmail.com', 'gannon2@gmail.com', 'gannon3@gmail.com']
	);
});

test('client accepts array sender', async (t) => {
	const msg = new Message({
		from: ['zelda@gmail.com'],
		to: ['gannon1@gmail.com'],
	});
	msg.header.from = [msg.header.from as string];

	const { isValid } = msg.checkValidity();
	t.true(isValid);
});

test('client rejects message without `from` header', async (t) => {
	const error = await t.throwsAsync(
		send({
			subject: 'this is a test TEXT message from emailjs',
			text: "It is hard to be brave when you're only a Very Small Animal.",
		})
	);
	t.is(error?.message, 'Message must have a `from` header');
});

test('client rejects message without `to`, `cc`, or `bcc` header', async (t) => {
	const error = await t.throwsAsync(
		send({
			subject: 'this is a test TEXT message from emailjs',
			from: 'piglet@gmail.com',
			text: "It is hard to be brave when you're only a Very Small Animal.",
		})
	);
	t.is(
		error?.message,
		'Message must have at least one `to`, `cc`, or `bcc` header'
	);
});

test('client allows message with only `cc` recipient header', async (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		cc: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};

	const mail = await send(msg);
	t.is(mail.text, msg.text + '\n\n\n');
	t.is(mail.subject, msg.subject);
	t.is(mail.from?.text, msg.from);
	t.is((mail.cc as AddressObject).text, msg.cc);
});

test('client allows message with only `bcc` recipient header', async (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		bcc: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};

	const mail = await send(msg);
	t.is(mail.text, msg.text + '\n\n\n');
	t.is(mail.subject, msg.subject);
	t.is(mail.from?.text, msg.from);
	t.is(mail.bcc, undefined);
});

test('client constructor throws if `password` supplied without `user`', async (t) => {
	t.notThrows(() => new SMTPClient({ user: 'anything', password: 'anything' }));
	t.throws(() => new SMTPClient({ password: 'anything' }));
	t.throws(
		() =>
			new SMTPClient({ username: 'anything', password: 'anything' } as Record<
				string,
				unknown
			>)
	);
});

test('client supports greylisting', async (t) => {
	t.plan(3);

	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		bcc: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};

	const greylistServer = new SMTPServer({
		secure: true,
		onRcptTo(_address, _session, callback) {
			t.pass();
			callback();
		},
		onAuth(auth, _session, callback) {
			if (auth.username === 'pooh' && auth.password === 'honey') {
				callback(null, { user: 'pooh' });
			} else {
				return callback(new Error('invalid user / pass'));
			}
		},
	});

	const { onRcptTo } = greylistServer;
	greylistServer.onRcptTo = (_address, _session, callback) => {
		greylistServer.onRcptTo = (a, s, cb) => {
			t.pass();
			const err = new Error('greylist');
			(err as never as { responseCode: number }).responseCode = 450;
			greylistServer.onRcptTo = onRcptTo;
			onRcptTo(a, s, cb);
		};

		const err = new Error('greylist');
		(err as never as { responseCode: number }).responseCode = 450;
		callback(err);
	};

	const p = greylistPort++;
	await t.notThrowsAsync(
		new Promise<void>((resolve, reject) => {
			greylistServer.listen(p, () => {
				new SMTPClient({
					port: p,
					user: 'pooh',
					password: 'honey',
					ssl: true,
				}).send(new Message(msg), (err) => {
					greylistServer.close();
					if (err) {
						reject(err);
					} else {
						resolve();
					}
				});
			});
		})
	);
});

test('client only responds once to greylisting', async (t) => {
	t.plan(4);

	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		bcc: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};

	const greylistServer = new SMTPServer({
		secure: true,
		onRcptTo(_address, _session, callback) {
			t.pass();
			const err = new Error('greylist');
			(err as never as { responseCode: number }).responseCode = 450;
			callback(err);
		},
		onAuth(auth, _session, callback) {
			if (auth.username === 'pooh' && auth.password === 'honey') {
				callback(null, { user: 'pooh' });
			} else {
				return callback(new Error('invalid user / pass'));
			}
		},
	});

	const p = greylistPort++;
	const error = await t.throwsAsync(
		new Promise<void>((resolve, reject) => {
			greylistServer.listen(p, () => {
				new SMTPClient({
					port: p,
					user: 'pooh',
					password: 'honey',
					ssl: true,
				}).send(new Message(msg), (err) => {
					greylistServer.close();
					if (err) {
						reject(err);
					} else {
						resolve();
					}
				});
			});
		})
	);
	t.is(error?.message, "bad response on command 'RCPT': greylist");
});

test('client send can have result awaited when promisified', async (t) => {
	// bind necessary to retain internal access to client prototype
	const sendAsync = promisify(client.send.bind(client));

	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		bcc: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};

	try {
		const message = (await sendAsync(new Message(msg))) as Message;
		t.true(message instanceof Message);
		t.like(message, {
			alternative: null,
			content: 'text/plain; charset=utf-8',
			text: "It is hard to be brave when you're only a Very Small Animal.",
			header: {
				bcc: 'pooh@gmail.com',
				from: 'piglet@gmail.com',
				subject: '=?UTF-8?Q?this_is_a_test_TEXT_message_from_emailjs?=',
			},
		});
		t.deepEqual(message.attachments, []);
		t.true(isRFC2822Date(message.header.date as string));
		t.regex(message.header['message-id'] as string, /^<.*[@]{1}.*>$/);
	} catch (err) {
		if (err instanceof Error) {
			t.fail(err.message);
		} else if (typeof err === 'string') {
			t.fail(err);
		} else {
			t.fail();
		}
	}
});

test('client sendAsync can have result awaited', async (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		bcc: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};

	try {
		const message = await client.sendAsync(new Message(msg));
		t.true(message instanceof Message);
		t.like(message, {
			alternative: null,
			content: 'text/plain; charset=utf-8',
			text: "It is hard to be brave when you're only a Very Small Animal.",
			header: {
				bcc: 'pooh@gmail.com',
				from: 'piglet@gmail.com',
				subject: '=?UTF-8?Q?this_is_a_test_TEXT_message_from_emailjs?=',
			},
		});
		t.deepEqual(message.attachments, []);
		t.true(isRFC2822Date(message.header.date as string));
		t.regex(message.header['message-id'] as string, /^<.*[@]{1}.*>$/);
	} catch (err) {
		if (err instanceof Error) {
			t.fail(err.message);
		} else if (typeof err === 'string') {
			t.fail(err);
		} else {
			t.fail();
		}
	}
});

test('client sendAsync can have error caught when awaited', async (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		bcc: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};

	try {
		const invalidClient = new SMTPClient({ host: '127.0.0.1' });
		const message = await invalidClient.sendAsync(new Message(msg));
		t.true(message instanceof Message);
		t.fail();
	} catch (err) {
		t.true(err instanceof Error);
		t.pass();
	}
});
