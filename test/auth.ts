import test, { ExecutionContext } from 'ava';
import { simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';

import { AUTH_METHODS, SMTPClient, Message } from '../email';

let port = 2000;

function send(
	t: ExecutionContext,
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
	return new Promise((resolve, reject) => {
		t.plan(5);

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
			onAuth(auth, _session, callback) {
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
			},
			async onData(stream, _session, callback: () => void) {
				const mail = await simpleParser(stream, {
					skipHtmlToText: true,
					skipTextToHtml: true,
					skipImageLinks: true,
				} as Record<string, unknown>);

				t.is(mail.text, msg.text + '\n\n\n');
				t.is(mail.subject, msg.subject);
				t.is(mail.from?.text, msg.from);
				t.is(mail.to?.text, msg.to);

				callback();
			},
		});
		const p = port++;
		server.listen(p, () => {
			const options = Object.assign(
				{ port: p, ssl: secure, authentication: authMethods },
				authOptional ? {} : { user: 'pooh', password: 'honey' }
			);
			new SMTPClient(options).send(new Message(msg), (err) => {
				server.close(() => {
					if (err) {
						reject(err.message);
					} else {
						resolve();
					}
				});
			});
		});
	});
}

test('no authentication (unencrypted) should succeed', async (t) => {
	await t.notThrowsAsync(send(t, { authOptional: true }));
});

test('no authentication (encrypted) should succeed', async (t) => {
	await t.notThrowsAsync(send(t, { authOptional: true, secure: true }));
});

test('PLAIN authentication (unencrypted) should succeed', async (t) => {
	await t.notThrowsAsync(send(t, { authMethods: [AUTH_METHODS.PLAIN] }));
});

test('PLAIN authentication (encrypted) should succeed', async (t) => {
	await t.notThrowsAsync(
		send(t, { authMethods: [AUTH_METHODS.PLAIN], secure: true })
	);
});

test('LOGIN authentication (unencrypted) should succeed', async (t) => {
	await t.notThrowsAsync(send(t, { authMethods: [AUTH_METHODS.LOGIN] }));
});

test('LOGIN authentication (encrypted) should succeed', async (t) => {
	await t.notThrowsAsync(
		send(t, { authMethods: [AUTH_METHODS.LOGIN], secure: true })
	);
});

test('XOAUTH2 authentication (unencrypted) should succeed', async (t) => {
	await t.notThrowsAsync(send(t, { authMethods: [AUTH_METHODS.XOAUTH2] }));
});

test('XOAUTH2 authentication (encrypted) should succeed', async (t) => {
	await t.notThrowsAsync(
		send(t, { authMethods: [AUTH_METHODS.XOAUTH2], secure: true })
	);
});
