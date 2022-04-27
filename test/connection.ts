import test from 'ava';

import { SMTPConnection } from '../email.js';

test('accepts a custom logger', async (t) => {
	const logger = () => {
		/** ø */
	};
	const connection = new SMTPConnection({ logger });
	t.is(Reflect.get(connection, 'log'), logger);
});
