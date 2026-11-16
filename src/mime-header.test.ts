import { describe, it, expect } from 'vitest'
import {
	foldSubject,
	formatHeaderName,
	sanitizeHeaderValue,
} from './mime-header.js'

describe('MIME header helpers', () => {
	describe('foldSubject', () => {
		it.each(['', '=?UTF-8?Q?Ready_for_review?='])(
			'leaves an empty or short value unchanged: %j',
			(value) => {
				expect(foldSubject(value)).toBe(value)
			}
		)

		it.each([
			['c', false],
			['cd', false],
			['cde', true],
		] as const)(
			'counts the Subject prefix at the 76-character boundary: %s',
			(suffix, folded) => {
				const first = `=?UTF-8?Q?${'a'.repeat(40)}?=`
				const second = `=?UTF-8?Q?${suffix}?=`
				expect(foldSubject(`${first} ${second}`)).toBe(
					folded ? `${first}\r\n ${second}` : `${first} ${second}`
				)
			}
		)

		it.each([
			[25, false],
			[26, true],
		] as const)(
			'counts continuation whitespace when the final word has %i payload characters',
			(payloadLength, folded) => {
				const first = `=?UTF-8?Q?${'a'.repeat(52)}?=`
				const second = `=?UTF-8?Q?${'b'.repeat(25)}?=`
				const third = `=?UTF-8?Q?${'c'.repeat(payloadLength)}?=`
				const value = `${first} ${second} ${third}`
				const result = foldSubject(value)

				expect(result).toBe(
					folded
						? `${first}\r\n ${second}\r\n ${third}`
						: `${first}\r\n ${second} ${third}`
				)
				expect(result.replace(/\r\n /g, ' ')).toBe(value)
				expect(
					`Subject: ${result}`.split('\r\n').every((line) => line.length <= 76)
				).toBe(true)
			}
		)

		it('never splits an indivisible value', () => {
			const value = 'x'.repeat(100)
			expect(foldSubject(value)).toBe(value)
		})
	})

	it.each([
		['content-type', 'Content-Type'],
		['CONTENT-TRANSFER-ENCODING', 'Content-Transfer-Encoding'],
		['x-ReViEw-NoTe', 'X-Review-Note'],
		['subject', 'Subject'],
	])(
		'formats the header name %s without changing its spelling',
		(name, expected) => {
			expect(formatHeaderName(name)).toBe(expected)
		}
	)

	it.each([
		['ordinary value', 'ordinary value'],
		['first\r\nBcc: hidden@injection.test', 'firstBcc: hidden@injection.test'],
		['first\rsecond', 'firstsecond'],
		['first\nsecond', 'firstsecond'],
	])('removes untrusted newlines from %j', (value, expected) => {
		expect(sanitizeHeaderValue(value)).toBe(expected)
	})
})
