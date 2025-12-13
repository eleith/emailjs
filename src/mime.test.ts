import { describe, it, expect } from 'vitest'
import { mimeEncode, mimeWordEncode } from './mime.js'

describe('mime', () => {
	it('mimeEncode should encode UTF-8', () => {
		expect(mimeEncode('tere ÕÄÖÕ')).toBe('tere =C3=95=C3=84=C3=96=C3=95')
	})

	it('mimeEncode should encode trailing whitespace', () => {
		expect(mimeEncode('tere  ')).toBe('tere =20')
	})

	it('mimeEncode should encode non UTF-8', () => {
		expect(mimeEncode(new Uint8Array([0xbd, 0xc5]), 'utf-16be')).toBe(
			'=EB=B7=85'
		)
	})

	it('mimeWordEncode should encode', () => {
		expect(mimeWordEncode('See on õhin test')).toBe(
			'=?UTF-8?Q?See_on_=C3=B5hin_test?='
		)
	})

	it('mimeWordEncode should QP-encode mime word', () => {
		expect(
			mimeWordEncode(
				new Uint8Array([0x4a, 0xf5, 0x67, 0x65, 0x2d, 0x76, 0x61, 0xde]),
				'Q',
				'utf-16be'
			)
		).toBe('=?UTF-8?Q?=E4=AB=B5=E6=9D=A5=E2=B5=B6=E6=87=9E?=')
	})

	it('mimeWordEncode should Base64-encode mime word', () => {
		expect(mimeWordEncode('Привет и до свидания', 'B')).toBe(
			'=?UTF-8?B?0J/RgNC40LLQtdGCINC4INC00L4g0YHQstC40LTQsNC90LjRjw==?='
		)
	})

	it('mimeWordEncode should Base64-encode a long mime word', () => {
		const payload =
			'üöß‹€Привет и до свиданияПривет и до свиданияПривет и до свиданияПривет и до свиданияПривет и до свиданияПривет и до свиданияПривет и до свиданияПривет и до свидания'
		const expected =
			'=?UTF-8?B?w7zDtsOf4oC54oKs0J/RgNC40LLQtdGCINC4INC00L4g0YHQstC4?= ' +
			'=?UTF-8?B?0LTQsNC90LjRj9Cf0YDQuNCy0LXRgiDQuCDQtNC+INGB0LLQuNC0?= ' +
			'=?UTF-8?B?0LDQvdC40Y/Qn9GA0LjQstC10YIg0Lgg0LTQviDRgdCy0LjQtNCw?= ' +
			'=?UTF-8?B?0L3QuNGP0J/RgNC40LLQtdGCINC4INC00L4g0YHQstC40LTQsNC9?= ' +
			'=?UTF-8?B?0LjRj9Cf0YDQuNCy0LXRgiDQuCDQtNC+INGB0LLQuNC00LDQvdC4?= ' +
			'=?UTF-8?B?0Y/Qn9GA0LjQstC10YIg0Lgg0LTQviDRgdCy0LjQtNCw0L3QuNGP?= ' +
			'=?UTF-8?B?0J/RgNC40LLQtdGCINC4INC00L4g0YHQstC40LTQsNC90LjRj9Cf?= ' +
			'=?UTF-8?B?0YDQuNCy0LXRgiDQuCDQtNC+INGB0LLQuNC00LDQvdC40Y8=?='
		expect(mimeWordEncode(payload, 'B')).toBe(expected)
	})
})
