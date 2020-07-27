import test, { CbExecutionContext } from 'ava';
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

let port = 1000;
function send(
	t: CbExecutionContext,
	{
		authMethods = [],
		authOptional = false,
		secure = false,
	}: {
		authMethods?: (keyof typeof AUTH_METHODS)[];
		authOptional?: boolean;
		secure?: boolean;
	} = {}
) {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'piglet@gmail.com',
		to: 'pooh@gmail.com',
		text: "It is hard to be brave when you're only a Very Small Animal.",
	};
	const server = new SMTPServer({
		authMethods,
		secure: secure,
		hideSTARTTLS: !secure,
		authOptional,
		onAuth,
		onData(stream, _session, callback: () => void) {
			simpleParser(stream, {
				skipHtmlToText: true,
				skipTextToHtml: true,
				skipImageLinks: true,
			} as Record<string, unknown>).then((mail) => {
				t.is(mail.text, msg.text + '\n\n\n');
				t.is(mail.subject, msg.subject);
				t.is(mail.from?.text, msg.from);
				t.is(mail.to?.text, msg.to);
			});
			stream.on('end', callback);
		},
	});
	const p = port++;
	server.listen(p, () => {
		const options = Object.assign(
			{ port: p, ssl: secure, authentication: authMethods },
			authOptional ? {} : { user: 'pooh', password: 'honey' }
		);
		new SMTPClient(options).send(new Message(msg), (err) => {
			server.close();
			t.end(err);
		});
	});
}

test.cb('no authentication (unencrypted) should succeed', (t) => {
	send(t, { authOptional: true });
});

test.cb('no authentication (encrypted) should succeed', (t) => {
	send(t, { authOptional: true, secure: true });
});

test.cb('PLAIN authentication (unencrypted) should succeed', (t) => {
	send(t, { authMethods: [AUTH_METHODS.PLAIN] });
});

test.cb('PLAIN authentication (encrypted) should succeed', (t) => {
	send(t, { authMethods: [AUTH_METHODS.PLAIN], secure: true });
});

test.cb('LOGIN authentication (unencrypted) should succeed', (t) => {
	send(t, { authMethods: [AUTH_METHODS.LOGIN] });
});

test.cb('LOGIN authentication (encrypted) should succeed', (t) => {
	send(t, { authMethods: [AUTH_METHODS.LOGIN], secure: true });
});

test.cb('XOAUTH2 authentication (unencrypted) should succeed', (t) => {
	send(t, { authMethods: [AUTH_METHODS.XOAUTH2] });
});

test.cb('XOAUTH2 authentication (encrypted) should succeed', (t) => {
	send(t, { authMethods: [AUTH_METHODS.XOAUTH2], secure: true });
});
