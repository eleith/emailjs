import test from 'ava';
import mailparser from 'mailparser';
import smtp from 'smtp-server';

import { client as c, message as m } from '../email';

function onAuth(
	auth: smtp.SMTPServerAuthentication,
	_session: smtp.SMTPServerSession,
	callback: (
		err: Error | null | undefined,
		response?: smtp.SMTPServerAuthenticationResponse | undefined
	) => void
) {
	if (auth.username == 'pooh' && auth.password == 'honey') {
		callback(null, { user: 'pooh' });
	} else {
		return callback(new Error('invalid user / pass'));
	}
}

const port = 2526;
const client = new c.Client({
	port,
	user: 'pooh',
	password: 'honey',
	ssl: true,
});
let server: smtp.SMTPServer | null = null;

test.afterEach.cb((t) => server?.close(t.end));

test.cb('no authentication should succeed', (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		to: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};
	server = new smtp.SMTPServer({
		authMethods: [],
		authOptional: true,
		onData(stream, _session, callback: () => void) {
			mailparser
				.simpleParser(stream)
				.then((mail) => {
					t.is(mail.text, msg.text + '\n\n\n');
					t.is(mail.subject, msg.subject);
					t.is(mail.from?.text, msg.from);
					t.is(mail.to?.text, msg.to);
				})
				.finally(t.end);
			stream.on('end', callback);
		},
	});
	server.listen(port, () => {
		new c.Client({ port }).send(new m.Message(msg), (err) => {
			if (err) {
				throw err;
			}
		});
	});
});

test.cb('PLAIN authentication should succeed', (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		to: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};
	server = new smtp.SMTPServer({
		secure: true,
		authMethods: ['PLAIN'],
		onAuth,
		onData(stream, _session, callback: () => void) {
			mailparser
				.simpleParser(stream)
				.then((mail) => {
					t.is(mail.text, msg.text + '\n\n\n');
					t.is(mail.subject, msg.subject);
					t.is(mail.from?.text, msg.from);
					t.is(mail.to?.text, msg.to);
				})
				.finally(t.end);
			stream.on('end', callback);
		},
	});
	server.listen(port, () => {
		client.send(new m.Message(msg), (err) => {
			if (err) {
				throw err;
			}
		});
	});
});

test.cb('LOGIN authentication should succeed', (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		to: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};
	server = new smtp.SMTPServer({
		secure: true,
		authMethods: ['LOGIN'],
		onAuth,
		onData(stream, _session, callback: () => void) {
			mailparser
				.simpleParser(stream)
				.then((mail) => {
					t.is(mail.text, msg.text + '\n\n\n');
					t.is(mail.subject, msg.subject);
					t.is(mail.from?.text, msg.from);
					t.is(mail.to?.text, msg.to);
				})
				.finally(t.end);
			stream.on('end', callback);
		},
	});
	server.listen(port, () => {
		client.send(new m.Message(msg), (err) => {
			if (err) {
				throw err;
			}
		});
	});
});
