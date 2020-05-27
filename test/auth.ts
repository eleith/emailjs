import test from 'ava';
import { simpleParser } from 'mailparser';
import {
	SMTPServer,
	SMTPServerAuthentication,
	SMTPServerAuthenticationResponse,
	SMTPServerSession,
} from 'smtp-server';

import { AUTH_METHODS, SMTPClient, Message } from '../email';

function onAuth(
	auth: SMTPServerAuthentication,
	_session: SMTPServerSession,
	callback: (
		err: Error | null | undefined,
		response?: SMTPServerAuthenticationResponse | undefined
	) => void
) {
	const { accessToken, method, username, password } = auth;
	if (
		(method === AUTH_METHODS.XOAUTH2 && password != null
			? accessToken === 'pooh'
			: username === 'pooh') &&
		(method === AUTH_METHODS.XOAUTH2 && password == null
			? accessToken === 'honey'
			: password === 'honey')
	) {
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
		new SMTPClient({ port }).send(new Message(msg), (err) => {
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
		new SMTPClient({ port, ssl: true }).send(new Message(msg), (err) => {
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
		authMethods: [AUTH_METHODS.PLAIN],
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
		new SMTPClient({
			port,
			user: 'pooh',
			password: 'honey',
			authentication: [AUTH_METHODS.PLAIN],
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
		authMethods: [AUTH_METHODS.PLAIN],
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
		new SMTPClient({
			port,
			user: 'pooh',
			password: 'honey',
			authentication: [AUTH_METHODS.PLAIN],
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
		authMethods: [AUTH_METHODS.LOGIN],
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
		new SMTPClient({
			port,
			user: 'pooh',
			password: 'honey',
			authentication: [AUTH_METHODS.LOGIN],
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
		authMethods: [AUTH_METHODS.LOGIN],
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
		new SMTPClient({
			port,
			user: 'pooh',
			password: 'honey',
			ssl: true,
			authentication: [AUTH_METHODS.LOGIN],
		}).send(new Message(msg), (err) => {
			if (err) {
				throw err;
			}
		});
	});
});

test.cb('XOAUTH2 authentication (unencrypted) should succeed', (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		to: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};
	server = new SMTPServer({
		authMethods: [AUTH_METHODS.XOAUTH2],
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
		new SMTPClient({
			port,
			user: 'pooh',
			password: 'honey',
			authentication: [AUTH_METHODS.XOAUTH2],
		}).send(new Message(msg), (err) => {
			if (err) {
				throw err;
			}
		});
	});
});

test.cb('XOAUTH2 authentication (encrypted) should succeed', (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		to: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};
	server = new SMTPServer({
		authMethods: [AUTH_METHODS.XOAUTH2],
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
		new SMTPClient({
			port,
			user: 'pooh',
			password: 'honey',
			ssl: true,
			authentication: [AUTH_METHODS.XOAUTH2],
		}).send(new Message(msg), (err) => {
			if (err) {
				throw err;
			}
		});
	});
});
