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

	describe('Base64 Unicode boundaries', () => {
		function decodeWords(encoded: string) {
			const decoder = new TextDecoder('utf-8', { fatal: true })
			return encoded
				.split(/\s+/u)
				.map((word) => {
					const match = word.match(/^=\?UTF-8\?B\?([A-Za-z0-9+/]+={0,2})\?=$/)
					if (match === null) {
						throw new Error(`Invalid Base64 MIME word: ${word}`)
					}
					expect(word.length).toBeLessThanOrEqual(75)
					expect(match[1].length % 4).toBe(0)
					return decoder.decode(Buffer.from(match[1], 'base64'))
				})
				.join('')
		}

		function encodeExpectedWords(chunks: string[]) {
			return chunks
				.map((chunk) => `=?UTF-8?B?${Buffer.from(chunk).toString('base64')}?=`)
				.join(' ')
		}

		it.each([0, 33, 34, 35, 36, 37, 38, 39, 40, 74, 75, 76, 77])(
			'preserves a supplementary character after %i ASCII characters',
			(prefixLength) => {
				const input = 'p'.repeat(prefixLength) + '𝄢 / cleared'
				expect(decodeWords(mimeWordEncode(input, 'B'))).toBe(input)
			}
		)

		it('preserves mixed Unicode across repeated chunk boundaries', () => {
			const input = 'Survey 𝄢 — 測定 🚲 '.repeat(17)
			expect(decodeWords(mimeWordEncode(input, 'B'))).toBe(input)
		})

		it.each([
			['utf8', 'utf-8'],
			['utf16le', 'utf-16le'],
		] as const)(
			'preserves supplementary characters from %s byte input',
			(bufferEncoding, charset) => {
				const input = 'r'.repeat(36) + '𝄢 / reviewed'
				const bytes = new Uint8Array(Buffer.from(input, bufferEncoding))
				expect(decodeWords(mimeWordEncode(bytes, 'B', charset))).toBe(input)
			}
		)

		it.each([
			{ name: '40-byte ASCII tail', chunks: ['x'.repeat(40)] },
			{
				name: '41-byte tail ending in a two-byte character',
				chunks: ['x'.repeat(39) + 'é'],
			},
			{
				name: '42-byte tail ending in a three-byte character',
				chunks: ['x'.repeat(39) + '森'],
			},
			{
				name: '40-byte tail ending in a surrogate pair',
				chunks: ['x'.repeat(36) + '𝄢'],
			},
			{
				name: 'final surrogate pair after a full chunk',
				chunks: ['x'.repeat(39), '𝄢'],
			},
			{
				name: '40-byte tail after a full chunk',
				chunks: ['x'.repeat(39), 'y'.repeat(40)],
			},
		])('preserves existing output for a $name', ({ chunks }) => {
			expect(mimeWordEncode(chunks.join(''), 'B')).toBe(
				encodeExpectedWords(chunks)
			)
		})

		it('preserves empty Base64 output', () => {
			expect(mimeWordEncode('', 'B')).toBe('')
		})

		it.each(['\uD800', '\uDC00'])(
			'preserves replacement behavior for an unpaired surrogate: %j',
			(surrogate) => {
				const prefix = 's'.repeat(36)
				const input = prefix + surrogate + ' / reviewed'
				expect(decodeWords(mimeWordEncode(input, 'B'))).toBe(
					prefix + '\uFFFD / reviewed'
				)
			}
		)
	})

	it('splitMimeEncodedString should split long encoded strings', () => {
		const input =
			'This is a very long encoded string that needs to be split into multiple parts because it exceeds the maximum length allowed for mime words in email headers'
		const output = mimeWordEncode(input, 'Q')
		expect(output).toContain('?= =?UTF-8?Q?')
		expect(output.length).toBeGreaterThan(100)
	})

	it('handles invalid QP sequences in split', () => {
		const input = 'a'.repeat(60) + '€'
		const output = mimeWordEncode(input, 'Q')
		expect(output).toContain('?= =?UTF-8?Q?')
	})

	it('encodes base64 with 1 byte padding', () => {
		expect(mimeWordEncode('a', 'B')).toContain('YQ==')
	})

	it('encodes base64 with 2 byte padding', () => {
		expect(mimeWordEncode('ab', 'B')).toContain('YWI=')
	})

	it('encodes base64 with 0 byte padding', () => {
		expect(mimeWordEncode('abc', 'B')).toContain('YWJj')
	})

	it('mimeEncode encodes specific control characters and spaces correctly', () => {
		expect(mimeEncode('a b ')).toBe('a b=20')
		expect(mimeEncode('a\t')).toBe('a=09')
		expect(mimeEncode(' \n')).toBe('=20\n')
		expect(mimeEncode('\t\r')).toBe('=09\r')
	})

	it('handles split inside incomplete escape sequence (case 1: ends with =)', () => {
		const input = 'a'.repeat(51) + ' '
		const output = mimeWordEncode(input, 'Q')
		expect(output).toContain('?= =?UTF-8?Q?=20')
	})

	it('handles split inside incomplete escape sequence (case 2: ends with =X)', () => {
		const input = 'a'.repeat(50) + ' '
		const output = mimeWordEncode(input, 'Q')
		expect(output).toContain('?= =?UTF-8?Q?=20')
	})

	it('handles split inside UTF-8 multibyte sequence', () => {
		const input = 'a'.repeat(49) + 'Õ'
		const output = mimeWordEncode(input, 'Q')
		expect(output).toContain('?= =?UTF-8?Q?=C3=95')
	})
})
