import { promisify } from 'util';

import test, { CbExecutionContext } from 'ava';
import { simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';

import { DEFAULT_TIMEOUT, SMTPClient, Message } from '../email';

type UnPromisify<T> = T extends Promise<infer U> ? U : T;

let port = 3000;
let greylistPort = 4000;

function send(
	t: CbExecutionContext,
	message: Message,
	verify: (mail: UnPromisify<ReturnType<typeof simpleParser>>) => void
) {
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
			verify(mail);
			callback();
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

test('client invokes callback exactly once for invalid connection', async (t) => {
	t.plan(1);
	const msg = {
		from: 'foo@bar.baz',
		to: 'foo@bar.baz',
		subject: 'hello world',
		text: 'hello world',
	};
	const client = new SMTPClient({ host: 'bar.baz' });
	const sendAsync = promisify(client.send.bind(client));
	try {
		await sendAsync(new Message(msg));
	} catch (err) {
		t.true(err instanceof Error);
	}
});

test('client has a default connection timeout', (t) => {
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

test('client deduplicates recipients', (t) => {
	const msg = {
		from: 'zelda@gmail.com',
		to: 'gannon@gmail.com',
		cc: 'gannon@gmail.com',
		bcc: 'gannon@gmail.com',
	};
	const stack = new SMTPClient({}).createMessageStack(new Message(msg));
	t.true(stack.to.length === 1);
	t.is(stack.to[0].address, 'gannon@gmail.com');
});

test.cb('client accepts array recipients', (t) => {
	const msg = new Message({
		from: 'zelda@gmail.com',
		to: ['gannon1@gmail.com'],
		cc: ['gannon2@gmail.com'],
		bcc: ['gannon3@gmail.com'],
	});

	msg.header.to = [msg.header.to as string];
	msg.header.cc = [msg.header.cc as string];
	msg.header.bcc = [msg.header.bcc as string];

	msg.valid((isValid) => {
		t.true(isValid);
		const stack = new SMTPClient({}).createMessageStack(msg);
		t.is(stack.to.length, 3);
		t.deepEqual(
			stack.to.map((x) => x.address),
			['gannon1@gmail.com', 'gannon2@gmail.com', 'gannon3@gmail.com']
		);
		t.end();
	});
});

test.cb('client accepts array sender', (t) => {
	const msg = new Message({
		from: ['zelda@gmail.com'],
		to: ['gannon1@gmail.com'],
	});

	msg.header.from = [msg.header.from as string];

	msg.valid((isValid) => {
		t.true(isValid);
		t.end();
	});
});

test('client rejects message without `from` header', async (t) => {
	t.plan(2);
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};
	const client = new SMTPClient({});
	const sendAsync = promisify(client.send.bind(client));
	try {
		await sendAsync(new Message(msg));
	} catch (err) {
		t.true(err instanceof Error);
		t.is(err?.message, 'Message must have a `from` header');
	}
});

test.cb('client rejects message without `to`, `cc`, or `bcc` header', (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};
	new SMTPClient({}).send(new Message(msg), (err) => {
		t.true(err instanceof Error);
		t.is(
			err?.message,
			'Message must have at least one `to`, `cc`, or `bcc` header'
		);
		t.end();
	});
});

test.cb('client allows message with only `cc` recipient header', (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		cc: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};

	send(t, new Message(msg), (mail) => {
		t.is(mail.text, msg.text + '\n\n\n');
		t.is(mail.subject, msg.subject);
		t.is(mail.from?.text, msg.from);
		t.is(mail.cc?.text, msg.cc);
	});
});

test.cb('client allows message with only `bcc` recipient header', (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		bcc: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};

	send(t, new Message(msg), (mail) => {
		t.is(mail.text, msg.text + '\n\n\n');
		t.is(mail.subject, msg.subject);
		t.is(mail.from?.text, msg.from);
		t.is(mail.bcc, undefined);
	});
});

test('client constructor throws if `password` supplied without `user`', (t) => {
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

test.cb('client supports greylisting', (t) => {
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
			((err as never) as { responseCode: number }).responseCode = 450;
			greylistServer.onRcptTo = onRcptTo;
			onRcptTo(a, s, cb);
		};

		const err = new Error('greylist');
		((err as never) as { responseCode: number }).responseCode = 450;
		callback(err);
	};

	const p = greylistPort++;
	greylistServer.listen(p, () => {
		new SMTPClient({
			port: p,
			user: 'pooh',
			password: 'honey',
			ssl: true,
		}).send(new Message(msg), (err) => {
			greylistServer.close();
			if (err) {
				t.fail();
			}
			t.pass();
			t.end();
		});
	});
});

test.cb('client only responds once to greylisting', (t) => {
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
			const err = new Error('greylist');
			((err as never) as { responseCode: number }).responseCode = 450;
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
	greylistServer.listen(p, () => {
		new SMTPClient({
			port: p,
			user: 'pooh',
			password: 'honey',
			ssl: true,
		}).send(new Message(msg), (err) => {
			greylistServer.close();
			if (err) {
				t.pass();
				t.end();
			} else {
				t.fail();
			}
		});
	});
});
