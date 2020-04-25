import test from 'ava';
import mailparser from 'mailparser';
import smtp from 'smtp-server';

import { client as c, message as m } from '../email';

const port = 2526;

const client = new c.Client({
	port,
	user: 'pooh',
	password: 'honey',
	ssl: true,
});
const server = new smtp.SMTPServer({ secure: true, authMethods: ['LOGIN'] });

type UnPromisify<T> = T extends Promise<infer U> ? U : T;
const send = (
	message: m.Message,
	verify: (
		mail: UnPromisify<ReturnType<typeof mailparser.simpleParser>>
	) => void
) => {
	server.onData = (
		stream: import('stream').Readable,
		_session,
		callback: () => void
	) => {
		mailparser.simpleParser(stream).then(verify);
		stream.on('end', callback);
	};
	client.send(message, (err) => {
		if (err) {
			throw err;
		}
	});
};

test.before.cb((t) => {
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // prevent CERT_HAS_EXPIRED errors

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

test.cb('authorize ssl', (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'pooh@gmail.com',
		to: 'rabbit@gmail.com',
		text: 'hello friend, i hope this message finds you well.',
	};

	send(new m.Message(msg), (mail) => {
		t.is(mail.text, msg.text + '\n\n\n');
		t.is(mail.subject, msg.subject);
		t.is(mail.from?.text, msg.from);
		t.is(mail.to?.text, msg.to);
		t.end();
	});
});