import test from 'ava';

import { client as c, message as m, SMTP } from '../email';

test.cb('connecting to wrong email server should not invoke callback multiple times', t => {
	t.timeout(5000);

	const client = new c.Client({ host: 'bar.baz' });
	const msg = {
		from: 'foo@bar.baz',
		to: 'foo@bar.baz',
		subject: 'hello world',
		text: 'hello world',
	};
	client.send(new m.Message(msg), err => {
		t.not(err, null);
		t.end();
	});
});

test('should have a default timeout', async t => {
	const connectionOptions = {
		user: 'username',
		password: 'password',
		host: '127.0.0.1',
		port: 1234,
		timeout: undefined as number | null | undefined
	};
	t.deepEqual(new c.Client(connectionOptions).smtp.timeout, SMTP.DEFAULT_TIMEOUT);

	connectionOptions.timeout = null;
	t.deepEqual(new c.Client(connectionOptions).smtp.timeout, SMTP.DEFAULT_TIMEOUT);

	connectionOptions.timeout = undefined;
	t.deepEqual(new c.Client(connectionOptions).smtp.timeout, SMTP.DEFAULT_TIMEOUT);
});
