import test from 'ava';
import { simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';

import { client as c, message as m } from '../email';

const port = 2526;

const client = new c.Client({
	port,
	user: 'pooh',
	password: 'honey',
	ssl: true,
});
const smtp = new SMTPServer({ secure: true, authMethods: ['LOGIN'] });

type UnPromisify<T> = T extends Promise<infer U> ? U : T;
const send = (
	message: m.Message,
	verify: (mail: UnPromisify<ReturnType<typeof simpleParser>>) => void
) => {
	smtp.onData = (
		stream: import('stream').Readable,
		_session,
		callback: () => void
	) => {
		simpleParser(stream).then(verify);
		stream.on('end', callback);
	};
	client.send(message, (err) => {
		if (err) {
			throw err;
		}
	});
};

test.before(() => {
	process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // prevent CERT_HAS_EXPIRED errors

	smtp.listen(port, function () {
		smtp.onAuth = function (auth, _session, callback) {
			if (auth.username == 'pooh' && auth.password == 'honey') {
				callback(null, { user: 'pooh' });
			} else {
				return callback(new Error('invalid user / pass'));
			}
		};
	});
});

test.after(() => smtp.close());

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
