// adapted from https://github.com/emailjs/emailjs-mime-codec/blob/6909c706b9f09bc0e5c3faf48f723cca53e5b352/src/mimecodec-unit.js
import test from 'ava';
import { mimeEncode, mimeWordEncode } from '../email.js';

test('mimeEncode should encode UTF-8', async (t) => {
	t.is(mimeEncode('tere ÕÄÖÕ'), 'tere =C3=95=C3=84=C3=96=C3=95');
});

test('mimeEncode should encode trailing whitespace', async (t) => {
	t.is(mimeEncode('tere  '), 'tere =20');
});

test('mimeEncode should encode non UTF-8', async (t) => {
	t.is(mimeEncode(new Uint8Array([0xbd, 0xc5]), 'utf-16be'), '=EB=B7=85');
});

test('mimeWordEncode should encode', async (t) => {
	t.is('=?UTF-8?Q?See_on_=C3=B5hin_test?=', mimeWordEncode('See on õhin test'));
});

test('mimeWordEncode should QP-encode mime word', async (t) => {
	t.is(
		'=?UTF-8?Q?=E4=AB=B5=E6=9D=A5=E2=B5=B6=E6=87=9E?=',
		mimeWordEncode(
			new Uint8Array([0x4a, 0xf5, 0x67, 0x65, 0x2d, 0x76, 0x61, 0xde]),
			'Q',
			'utf-16be'
		)
	);
});

test('mimeWordEncode should Base64-encode mime word', async (t) => {
	t.is(
		mimeWordEncode('Привет и до свидания', 'B'),
		'=?UTF-8?B?0J/RgNC40LLQtdGCINC4INC00L4g0YHQstC40LTQsNC90LjRjw==?='
	);
});

test('mimeWordEncode should Base64-encode a long mime word', async (t) => {
	const payload =
		'üöß‹€Привет и до свиданияПривет и до свиданияПривет и до свиданияПривет и до свиданияПривет и до свиданияПривет и до свиданияПривет и до свиданияПривет и до свидания';
	const expected =
		'=?UTF-8?B?w7zDtsOf4oC54oKs0J/RgNC40LLQtdGCINC4INC00L4g0YHQstC4?= ' +
		'=?UTF-8?B?0LTQsNC90LjRj9Cf0YDQuNCy0LXRgiDQuCDQtNC+INGB0LLQuNC0?= ' +
		'=?UTF-8?B?0LDQvdC40Y/Qn9GA0LjQstC10YIg0Lgg0LTQviDRgdCy0LjQtNCw?= ' +
		'=?UTF-8?B?0L3QuNGP0J/RgNC40LLQtdGCINC4INC00L4g0YHQstC40LTQsNC9?= ' +
		'=?UTF-8?B?0LjRj9Cf0YDQuNCy0LXRgiDQuCDQtNC+INGB0LLQuNC00LDQvdC4?= ' +
		'=?UTF-8?B?0Y/Qn9GA0LjQstC10YIg0Lgg0LTQviDRgdCy0LjQtNCw0L3QuNGP?= ' +
		'=?UTF-8?B?0J/RgNC40LLQtdGCINC4INC00L4g0YHQstC40LTQsNC90LjRj9Cf?= ' +
		'=?UTF-8?B?0YDQuNCy0LXRgiDQuCDQtNC+INGB0LLQuNC00LDQvdC40Y8=?=';
	t.is(mimeWordEncode(payload, 'B'), expected);
});
