import test from 'ava';
import mailparser from 'mailparser';
import smtp from 'smtp-server';

import { client as c, message as m, smtp as s } from '../email';

type UnPromisify<T> = T extends Promise<infer U> ? U : T;

const port = 2526;
const client = new c.Client({
	port,
	user: 'pooh',
	password: 'honey',
	ssl: true,
});
const server = new smtp.SMTPServer({ secure: true, authMethods: ['LOGIN'] });

const send = (
	message: m.Message,
	verify: (
		mail: UnPromisify<ReturnType<typeof mailparser.simpleParser>>
	) => void,
	done: () => void
) => {
	server.onData = (stream, _session, callback: () => void) => {
		mailparser.simpleParser(stream).then(verify).finally(done);
		stream.on('end', callback);
	};
	client.send(message, (err) => {
		if (err) {
			throw err;
		}
	});
};

test.before.cb((t) => {
	server.listen(port, function () {
		server.onAuth = function (auth, _session, callback) {
			if (auth.username == 'pooh' && auth.password == 'honey') {
				callback(null, { user: 'pooh' });
			} else {
				return callback(new Error('invalid user / pass'));
			}
		};
		t.end();
	});
});

test.after.cb((t) => server.close(t.end));

test.cb('client invokes callback exactly once for invalid connection', (t) => {
	t.plan(1);
	const client = new c.Client({ host: 'bar.baz' });
	const msg = {
		from: 'foo@bar.baz',
		to: 'foo@bar.baz',
		subject: 'hello world',
		text: 'hello world',
	};
	client.send(new m.Message(msg), (err) => {
		t.not(err, null);
		t.end();
	});
});

test('client has a default connection timeout', (t) => {
	const connectionOptions = {
		user: 'username',
		password: 'password',
		host: '127.0.0.1',
		port: 1234,
		timeout: undefined as number | null | undefined,
	};
	t.is(new c.Client(connectionOptions).smtp.timeout, s.DEFAULT_TIMEOUT);

	connectionOptions.timeout = null;
	t.is(new c.Client(connectionOptions).smtp.timeout, s.DEFAULT_TIMEOUT);

	connectionOptions.timeout = undefined;
	t.is(new c.Client(connectionOptions).smtp.timeout, s.DEFAULT_TIMEOUT);
});

test('client deduplicates recipients', (t) => {
	const msg = {
		from: 'zelda@gmail.com',
		to: 'gannon@gmail.com',
		cc: 'gannon@gmail.com',
		bcc: 'gannon@gmail.com',
	};
	const stack = new c.Client({}).createMessageStack(new m.Message(msg));
	t.true(stack.to.length === 1);
	t.is(stack.to[0].address, 'gannon@gmail.com');
});

test.cb('client rejects message without `from` header', (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};
	client.send(new m.Message(msg), (err) => {
		t.true(err instanceof Error);
		t.is(err?.message, 'Message must have a `from` header');
		t.end();
	});
});

test.cb('client rejects message without `to`, `cc`, or `bcc` header', (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};
	client.send(new m.Message(msg), (err) => {
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

	send(
		new m.Message(msg),
		(mail) => {
			t.is(mail.text, msg.text + '\n\n\n');
			t.is(mail.subject, msg.subject);
			t.is(mail.from?.text, msg.from);
			t.is(mail.cc?.text, msg.cc);
		},
		t.end
	);
});

test.cb('client allows message with only `bcc` recipient header', (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		bcc: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};

	send(
		new m.Message(msg),
		(mail) => {
			t.is(mail.text, msg.text + '\n\n\n');
			t.is(mail.subject, msg.subject);
			t.is(mail.from?.text, msg.from);
			t.is(mail.bcc?.text, undefined);
		},
		t.end
	);
});

test('client constructor throws if `password` supplied without `user`', (t) => {
	t.notThrows(() => new c.Client({ user: 'anything', password: 'anything' }));
	t.throws(() => new c.Client({ password: 'anything' }));
	t.throws(
		() =>
			new c.Client({ username: 'anything', password: 'anything' } as Record<
				string,
				unknown
			>)
	);
});
