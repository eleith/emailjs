import test from 'ava';
import { simpleParser } from 'mailparser';
import {
	SMTPServer,
	SMTPServerAuthentication,
	SMTPServerAuthenticationResponse,
	SMTPServerSession,
} from 'smtp-server';

import { Client, Message } from '../email';

function onAuth(
	auth: SMTPServerAuthentication,
	_session: SMTPServerSession,
	callback: (
		err: Error | null | undefined,
		response?: SMTPServerAuthenticationResponse | undefined
	) => void
) {
	if (auth.username == 'pooh' && auth.password == 'honey') {
		callback(null, { user: 'pooh' });
	} else {
		return callback(new Error('invalid user / pass'));
	}
}

const port = 2526;
let server: SMTPServer | null = null;

test.afterEach.cb((t) => server?.close(t.end));

test.cb('no authentication (unencrypted) should succeed', (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		to: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};
	server = new SMTPServer({
		authMethods: [],
		authOptional: true,
		onData(stream, _session, callback: () => void) {
			simpleParser(stream)
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
		new Client({ port }).send(new Message(msg), (err) => {
			if (err) {
				throw err;
			}
		});
	});
});

test.cb('no authentication (encrypted) should succeed', (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		to: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};
	server = new SMTPServer({
		authMethods: [],
		authOptional: true,
		secure: true,
		onData(stream, _session, callback: () => void) {
			simpleParser(stream)
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
		new Client({ port, ssl: true }).send(new Message(msg), (err) => {
			if (err) {
				throw err;
			}
		});
	});
});

test.cb('PLAIN authentication (unencrypted) should succeed', (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		to: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};
	server = new SMTPServer({
		authMethods: ['PLAIN'],
		hideSTARTTLS: true,
		onAuth,
		onData(stream, _session, callback: () => void) {
			simpleParser(stream)
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
		new Client({
			port,
			user: 'pooh',
			password: 'honey',
			authentication: ['PLAIN'],
		}).send(new Message(msg), (err) => {
			if (err) {
				throw err;
			}
		});
	});
});

test.cb('PLAIN authentication (encrypted) should succeed', (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		to: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};
	server = new SMTPServer({
		authMethods: ['PLAIN'],
		secure: true,
		onAuth,
		onData(stream, _session, callback: () => void) {
			simpleParser(stream)
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
		new Client({
			port,
			user: 'pooh',
			password: 'honey',
			authentication: ['PLAIN'],
			ssl: true,
		}).send(new Message(msg), (err) => {
			if (err) {
				throw err;
			}
		});
	});
});

test.cb('LOGIN authentication (unencrypted) should succeed', (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		to: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};
	server = new SMTPServer({
		authMethods: ['LOGIN'],
		hideSTARTTLS: true,
		onAuth,
		onData(stream, _session, callback: () => void) {
			simpleParser(stream)
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
		new Client({
			port,
			user: 'pooh',
			password: 'honey',
			authentication: ['LOGIN'],
		}).send(new Message(msg), (err) => {
			if (err) {
				throw err;
			}
		});
	});
});

test.cb('LOGIN authentication (encrypted) should succeed', (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		to: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};
	server = new SMTPServer({
		authMethods: ['LOGIN'],
		secure: true,
		onAuth,
		onData(stream, _session, callback: () => void) {
			simpleParser(stream)
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
		new Client({
			port,
			user: 'pooh',
			password: 'honey',
			ssl: true,
			authentication: ['LOGIN'],
		}).send(new Message(msg), (err) => {
			if (err) {
				throw err;
			}
		});
	});
});
