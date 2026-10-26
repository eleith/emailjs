import { describe, expect, it } from 'vitest'
import { tokenizeAddress } from './address-tokenizer.js'
import type { AddressToken } from './address-tokenizer.js'

// Build an expected delimiter token.
function operator(value: string): AddressToken {
	return { type: 'operator', value }
}

// Build an expected text token.
function text(value: string): AddressToken {
	return { type: 'text', value }
}

// Build expected tokens for an angle address.
function mailbox(address: string): AddressToken[] {
	return [operator('<'), text(address), operator('>')]
}

describe('tokenizeAddress', () => {
	const destination = 'route@delivery.test'
	const backup = 'backup@delivery.test'

	it('handles absent and blank input', () => {
		expect(tokenizeAddress()).toEqual([])
		expect(tokenizeAddress(' \t ')).toEqual([])
	})

	it('joins address arrays with comma tokens', () => {
		expect(tokenizeAddress([destination, backup])).toEqual([
			text(destination),
			operator(','),
			text(backup),
		])
	})

	it('trims text and omits empty spans without losing delimiters', () => {
		expect(tokenizeAddress(' "  Desk  " <> () ;')).toEqual([
			operator('"'),
			text('Desk'),
			operator('"'),
			operator('<'),
			operator('>'),
			operator('('),
			operator(')'),
			operator(';'),
		])
	})

	it('preserves empty groups and standalone separators', () => {
		expect(tokenizeAddress('Review:;,;')).toEqual([
			text('Review'),
			operator(':'),
			operator(';'),
			operator(','),
			operator(';'),
		])
	})

	describe.each([
		['nested comments', '(outer (inner); tail)', 'outer (inner); tail'],
		['escaped comment closer', String.raw`(outer \) ; tail)`, 'outer ) ; tail'],
		['escaped comment opener', String.raw`(outer \( ; tail)`, 'outer ( ; tail'],
		['quotes in a comment', '(outer "quoted; text")', 'outer "quoted; text"'],
		['escaped quote', String.raw`"Desk \"; west"`, 'Desk "; west'],
		['parentheses in a quoted name', '"Desk (; west)"', 'Desk (; west)'],
		['escaped backslash', String.raw`"Desk \\"`, 'Desk \\'],
		['escaped Unicode', String.raw`"Équipe \🙂; east"`, 'Équipe 🙂; east'],
	])('%s', (_label, prefix, decoded) => {
		it('decodes text without exposing protected delimiters', () => {
			expect(
				tokenizeAddress(`${prefix} <${destination}>, <${backup}>`)
			).toEqual([
				operator(prefix[0]),
				text(decoded),
				operator(prefix[0] === '(' ? ')' : '"'),
				...mailbox(destination),
				operator(','),
				...mailbox(backup),
			])
		})

		it('preserves raw syntax inside a group for later parsing', () => {
			const member = `${prefix} <${destination}>`
			expect(tokenizeAddress(`Review: ${member}; <${backup}>`)).toEqual([
				text('Review'),
				operator(':'),
				text(member),
				operator(';'),
				...mailbox(backup),
			])
		})
	})

	it.each([
		'"box>unit"@delivery.test',
		String.raw`"box\>unit"@delivery.test`,
		'box@[zone>west]',
		'box@[zone"west]',
		'box@[zone(west]',
		String.raw`box@[zone\](west]`,
		String.raw`box@[zone\\]`,
		String.raw`box@[zone\\\](west]`,
		'box@[IPv6:2001:db8::7]',
		'box@ (note)[zone(west]',
	])('preserves the boundaries of angle address %s', (address) => {
		expect(tokenizeAddress(`<${address}>, <${backup}>`)).toEqual([
			...mailbox(address),
			operator(','),
			...mailbox(backup),
		])
		expect(tokenizeAddress(`Review: <${address}>; <${backup}>`)).toEqual([
			text('Review'),
			operator(':'),
			text(`<${address}>`),
			operator(';'),
			...mailbox(backup),
		])
	})

	it('does not close an angle address inside a comment', () => {
		const address = `${destination}(desk (west) > shift)`
		expect(tokenizeAddress(`<${address}>, <${backup}>`)).toEqual([
			...mailbox(address),
			operator(','),
			...mailbox(backup),
		])
	})

	it('does not mistake an arbitrary bracket in a group name for a literal', () => {
		const member = `Desk [west <${destination}>`
		expect(tokenizeAddress(`Review: ${member}; <${backup}>`)).toEqual([
			text('Review'),
			operator(':'),
			text(member),
			operator(';'),
			...mailbox(backup),
		])
	})

	it('keeps unfinished nested comment text inside the comment', () => {
		expect(
			tokenizeAddress(`Dispatch <${destination}> (outer (inner), <${backup}>`)
		).toEqual([
			text('Dispatch'),
			...mailbox(destination),
			operator('('),
			text(`outer (inner), <${backup}>`),
		])
	})

	it('keeps an unfinished quote inside the group', () => {
		expect(tokenizeAddress('Review: "Desk; open')).toEqual([
			text('Review'),
			operator(':'),
			text('"Desk; open'),
		])
	})

	it('resets context between literal-bearing members and groups', () => {
		const members = `<box@[zone"west]>, <${destination}>`
		expect(
			tokenizeAddress(`Review: ${members}; Archive: <${backup}>;`)
		).toEqual([
			text('Review'),
			operator(':'),
			text(members),
			operator(';'),
			text('Archive'),
			operator(':'),
			text(`<${backup}>`),
			operator(';'),
		])
	})

	it('preserves recovery at a group terminator after a missing angle closer', () => {
		expect(tokenizeAddress(`Review: <${destination}; <${backup}>`)).toEqual([
			text('Review'),
			operator(':'),
			text(`<${destination}`),
			operator(';'),
			...mailbox(backup),
		])
	})

	it('retains trailing backslashes in unfinished names and comments', () => {
		expect(tokenizeAddress('"Desk\\')).toEqual([operator('"'), text('Desk\\')])
		expect(tokenizeAddress(`${destination} (desk\\`)).toEqual([
			text(destination),
			operator('('),
			text('desk\\'),
		])
		expect(tokenizeAddress('Review: "Desk\\')).toEqual([
			text('Review'),
			operator(':'),
			text('"Desk\\'),
		])
	})

	it.each([
		'box@[zone"west]',
		'box@[zone(west]',
		'box@[unfinished',
		'box@[unfinished"',
		'box@[unfinished(',
	])('preserves the group boundary after bare literal %s', (address) => {
		expect(tokenizeAddress(`Review: ${address}; <${backup}>`)).toEqual([
			text('Review'),
			operator(':'),
			text(address),
			operator(';'),
			...mailbox(backup),
		])
	})

	it('handles repeated unfinished literal openers without losing the group boundary', () => {
		const member = 'box@['.repeat(4096)
		expect(tokenizeAddress(`Review: ${member}; <${backup}>`)).toEqual([
			text('Review'),
			operator(':'),
			text(member),
			operator(';'),
			...mailbox(backup),
		])
	})

	it('recovers repeated unfinished groups without scanning later groups for a closer', () => {
		const count = 2048
		const input = 'Review: box@[unfinished;'.repeat(count) + `<${backup}>`
		const tokens = tokenizeAddress(input)
		expect(tokens).toHaveLength(count * 4 + 3)
		expect(tokens.slice(-3)).toEqual(mailbox(backup))
	})

	it('handles deep comments without recursive tokenization', () => {
		const contents = '('.repeat(4095) + 'desk' + ')'.repeat(4095)
		expect(tokenizeAddress(`Dispatch (${contents}) <${destination}>`)).toEqual([
			text('Dispatch'),
			operator('('),
			text(contents),
			operator(')'),
			...mailbox(destination),
		])
	})
})
