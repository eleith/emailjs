import { describe, it, expect } from 'vitest'
import { addressparser } from './address.js'
import { SMTPClient } from './client.js'
import { Message } from './message.js'

describe('addressparser', () => {
	it('should handle single address correctly', () => {
		expect(addressparser('andris@tr.ee')).toEqual([
			{ address: 'andris@tr.ee', name: '' },
		])
	})

	it('should handle multiple addresses correctly', () => {
		expect(addressparser('andris@tr.ee, andris@example.com')).toEqual([
			{ address: 'andris@tr.ee', name: '' },
			{ address: 'andris@example.com', name: '' },
		])
	})

	it('should handle unquoted name correctly', () => {
		expect(addressparser('andris <andris@tr.ee>')).toEqual([
			{ name: 'andris', address: 'andris@tr.ee' },
		])
	})

	it('should handle quoted name correctly', () => {
		expect(addressparser('"reinman, andris" <andris@tr.ee>')).toEqual([
			{ name: 'reinman, andris', address: 'andris@tr.ee' },
		])
	})

	it('should handle quoted semicolons correctly', () => {
		expect(addressparser('"reinman; andris" <andris@tr.ee>')).toEqual([
			{ name: 'reinman; andris', address: 'andris@tr.ee' },
		])
	})

	it('should handle unquoted name, unquoted address correctly', () => {
		expect(addressparser('andris andris@tr.ee')).toEqual([
			{ name: 'andris', address: 'andris@tr.ee' },
		])
	})

	it('should handle empty group correctly', () => {
		expect(addressparser('Undisclosed:;')).toEqual([
			{ name: 'Undisclosed', group: [] },
		])
	})

	it('should handle address group correctly', () => {
		expect(
			addressparser('Disclosed:andris@tr.ee, andris@example.com;')
		).toEqual([
			{
				name: 'Disclosed',
				group: [
					{ address: 'andris@tr.ee', name: '' },
					{ address: 'andris@example.com', name: '' },
				],
			},
		])
	})

	it('should handle semicolon as a delimiter', () => {
		expect(addressparser('andris@tr.ee; andris@example.com;')).toEqual([
			{ address: 'andris@tr.ee', name: '' },
			{ address: 'andris@example.com', name: '' },
		])
	})

	it('should handle mixed group correctly', () => {
		expect(
			addressparser(
				'Test User <test.user@mail.ee>, Disclosed:andris@tr.ee, andris@example.com;,,,, Undisclosed:;'
			)
		).toEqual([
			{ address: 'test.user@mail.ee', name: 'Test User' },
			{
				name: 'Disclosed',
				group: [
					{ address: 'andris@tr.ee', name: '' },
					{ address: 'andris@example.com', name: '' },
				],
			},
			{ name: 'Undisclosed', group: [] },
		])
	})

	it('semicolon as delimiter should not break group parsing ', () => {
		expect(
			addressparser(
				'Test User <test.user@mail.ee>; Disclosed:andris@tr.ee, andris@example.com;,,,, Undisclosed:; bob@example.com;'
			)
		).toEqual([
			{ address: 'test.user@mail.ee', name: 'Test User' },
			{
				name: 'Disclosed',
				group: [
					{
						address: 'andris@tr.ee',
						name: '',
					},
					{
						address: 'andris@example.com',
						name: '',
					},
				],
			},
			{ name: 'Undisclosed', group: [] },
			{ address: 'bob@example.com', name: '' },
		])
	})

	it('should handle name from comment correctly', () => {
		expect(addressparser('andris@tr.ee (andris)')).toEqual([
			{ name: 'andris', address: 'andris@tr.ee' },
		])
	})

	it('should handle skip comment correctly', () => {
		expect(addressparser('andris@tr.ee (reinman) andris')).toEqual([
			{ name: 'andris', address: 'andris@tr.ee' },
		])
	})

	it('should handle missing address correctly', () => {
		expect(addressparser('andris')).toEqual([{ name: 'andris', address: '' }])
	})

	it('should handle apostrophe in name correctly', () => {
		expect(addressparser("O'Neill")).toEqual([{ name: "O'Neill", address: '' }])
	})

	it('should handle particularly bad input, unescaped colon correctly', () => {
		expect(
			addressparser(
				'FirstName Surname-WithADash :: Company <firstname@company.com>'
			)
		).toEqual([
			{
				name: 'FirstName Surname-WithADash',
				group: [
					{
						name: undefined,
						group: [{ address: 'firstname@company.com', name: 'Company' }],
					},
				],
			},
		])
	})
})

// Reserved-domain fixtures verify parser composition without creating a transport.
describe('addressparser contexts', () => {
	const destination = 'route@delivery.test'
	const annotation = 'memo@annotation.test'
	const backup = 'backup@delivery.test'
	const nestedComment = `Dispatch (zone (west) note <${annotation}>) <${destination}>`

	it('keeps nested comment contents out of the recipient list', () => {
		expect(addressparser(`${nestedComment}, Backup <${backup}>`)).toEqual([
			{ name: 'Dispatch', address: destination },
			{ name: 'Backup', address: backup },
		])
	})

	it('preserves ordinary nested comment text', () => {
		expect(addressparser(`${destination} (region (west) desk)`)).toEqual([
			{ name: 'region (west) desk', address: destination },
		])
	})

	it('keeps a semicolon inside a group member comment', () => {
		const input = `Review: Lead (tag; note <${annotation}>) <${destination}>, Backup <${backup}>;`
		expect(addressparser(input)).toEqual([
			{
				name: 'Review',
				group: [
					{ name: 'Lead', address: destination },
					{ name: 'Backup', address: backup },
				],
			},
		])
	})

	it('keeps a semicolon inside a quoted group member name', () => {
		const input = `Review: "Quarterly; <${annotation}>" <${destination}>, Backup <${backup}>;`
		expect(addressparser(input)).toEqual([
			{
				name: 'Review',
				group: [
					{ name: `Quarterly; <${annotation}>`, address: destination },
					{ name: 'Backup', address: backup },
				],
			},
		])
	})

	it('still handles a quoted semicolon outside a group', () => {
		expect(addressparser(`"Dispatch; west" <${destination}>`)).toEqual([
			{ name: 'Dispatch; west', address: destination },
		])
	})

	it('still handles ordinary group members and a following mailbox', () => {
		expect(
			addressparser(`Review: Dispatch <${destination}>; Backup <${backup}>`)
		).toEqual([
			{
				name: 'Review',
				group: [{ name: 'Dispatch', address: destination }],
			},
			{ name: 'Backup', address: backup },
		])
	})

	it.each([
		['nested comments', '(outer (inner); tail)', 'outer (inner); tail'],
		['escaped comment closer', String.raw`(outer \) ; tail)`, 'outer ) ; tail'],
		['escaped comment opener', String.raw`(outer \( ; tail)`, 'outer ( ; tail'],
		['quotes in a comment', '(outer "quoted; text")', 'outer "quoted; text"'],
		['escaped quote', String.raw`"Desk \"; west"`, 'Desk "; west'],
		['parentheses in a quoted name', '"Desk (; west)"', 'Desk (; west)'],
		['escaped backslash', String.raw`"Desk \\"`, 'Desk \\'],
	])('decodes %s once when parsing group members', (_label, prefix, name) => {
		expect(
			addressparser(`Review: ${prefix} <${destination}>; <${backup}>`)
		).toEqual([
			{ name: 'Review', group: [{ name, address: destination }] },
			{ name: '', address: backup },
		])
	})

	it.each(['to', 'cc', 'bcc'] as const)(
		'preserves the intended %s recipient through Message construction',
		(field) => {
			// Bypass the constructor entirely: createMessageStack needs no socket,
			// SMTP connection, credentials, queue polling, or delivery methods.
			const client = Object.create(SMTPClient.prototype) as SMTPClient
			const message = new Message({
				from: 'sender@origin.test',
				[field]: nestedComment,
				text: 'Local regression fixture',
			})
			expect(message.checkValidity().isValid).toBe(true)
			const stack = client.createMessageStack(message)
			expect(stack.to.map(({ address }) => address)).toEqual([destination])
		}
	)
})
