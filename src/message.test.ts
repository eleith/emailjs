import { describe, it, expect } from 'vitest'
import { Readable } from 'stream'
import { Message } from './message.js'

describe('Message', () => {
	it('message validation fails without `from` header', () => {
		const msg = new Message({})
		const { isValid, validationError } = msg.checkValidity()
		expect(isValid).toBe(false)
		expect(validationError).toBe('Message must have a `from` header')
	})

	it('message validation fails without `to`, `cc`, or `bcc` header', () => {
		const { isValid, validationError } = new Message({
			from: 'piglet@gmail.com',
		}).checkValidity()

		expect(isValid).toBe(false)
		expect(validationError).toBe(
			'Message must have at least one `to`, `cc`, or `bcc` header'
		)
	})

	it('message validation succeeds with only `to` recipient header (string)', () => {
		const { isValid, validationError } = new Message({
			from: 'piglet@gmail.com',
			to: 'pooh@gmail.com',
		}).checkValidity()

		expect(isValid).toBe(true)
		expect(validationError).toBeUndefined()
	})

	it('message validation succeeds with only `to` recipient header (array)', () => {
		const { isValid, validationError } = new Message({
			from: 'piglet@gmail.com',
			to: ['pooh@gmail.com'],
		}).checkValidity()

		expect(isValid).toBe(true)
		expect(validationError).toBeUndefined()
	})

	it('message validation succeeds with only `cc` recipient header (string)', () => {
		const { isValid, validationError } = new Message({
			from: 'piglet@gmail.com',
			cc: 'pooh@gmail.com',
		}).checkValidity()

		expect(isValid).toBe(true)
		expect(validationError).toBeUndefined()
	})

	it('message validation succeeds with only `cc` recipient header (array)', () => {
		const { isValid, validationError } = new Message({
			from: 'piglet@gmail.com',
			cc: ['pooh@gmail.com'],
		}).checkValidity()

		expect(isValid).toBe(true)
		expect(validationError).toBeUndefined()
	})

	it('message validation succeeds with only `bcc` recipient header (string)', () => {
		const { isValid, validationError } = new Message({
			from: 'piglet@gmail.com',
			bcc: 'pooh@gmail.com',
		}).checkValidity()

		expect(isValid).toBe(true)
		expect(validationError).toBeUndefined()
	})

	it('message validation succeeds with only `bcc` recipient header (array)', () => {
		const { isValid, validationError } = new Message({
			from: 'piglet@gmail.com',
			bcc: ['pooh@gmail.com'],
		}).checkValidity()

		expect(isValid).toBe(true)
		expect(validationError).toBeUndefined()
	})

	it('message validation fails with non-existent file', () => {
		const msg = new Message({
			from: 'me',
			to: 'you',
			attachment: { path: 'non-existent-file.txt' },
		})
		const { isValid, validationError } = msg.checkValidity()
		expect(isValid).toBe(false)
		expect(validationError).toContain('does not exist')
	})

	it('message validation fails with unreadable stream', () => {
		const stream = new Readable()
		stream.readable = false
		const msg = new Message({
			from: 'me',
			to: 'you',
			attachment: { stream },
		})
		const { isValid, validationError } = msg.checkValidity()
		expect(isValid).toBe(false)
		expect(validationError).toContain('stream is not readable')
	})

	it('reads large message body correctly', async () => {
		const largeText = 'a'.repeat(1024 * 100) // 100KB
		const msg = new Message({
			from: 'me',
			to: 'you',
			text: largeText,
		})
		const output = await msg.readAsync()
		expect(output).toContain(largeText)
	})

	it('generates correct structure for related items inside alternative', async () => {
		const msg = new Message({
			from: 'me',
			to: 'you',
			text: 'plain text',
			attachment: [
				{
					data: '<html><img src="cid:1"></html>',
					alternative: true,
					related: [
						{
							data: 'image data',
							type: 'image/png',
							headers: { 'Content-ID': '<1>' },
						},
					],
				},
			],
		})
		const output = await msg.readAsync()
		expect(output).toContain('multipart/alternative')
		expect(output).toContain('multipart/related')
		expect(output).toContain('Content-Id: <1>')
	})

	it('excludes BCC from output headers', async () => {
		const msg = new Message({
			from: 'me',
			to: 'you',
			bcc: 'secret',
			text: 'hi'
		})
		const output = await msg.readAsync()
		// Header should not be present
		expect(output).not.toMatch(/^Bcc:/m)
	})

	it('includes standard and custom headers in output', async () => {
		const msg = new Message({
			from: 'me@example.com',
			to: 'you@example.com',
			subject: 'test subject',
			'X-Custom': 'custom value',
		})
		const output = await msg.readAsync()
		expect(output).toContain('From: me@example.com')
		expect(output).toContain('To: you@example.com')
		expect(output).toContain('Subject: =?UTF-8?Q?test_subject?=')
		expect(output).toContain('X-Custom: custom value')
	})

	it('accepts array of attachments in constructor', async () => {
		const msg = new Message({
			from: 'me',
			to: 'you',
			attachment: [
				{ data: 'a', name: 'a.txt' },
				{ data: 'b', name: 'b.txt' },
			],
		})
		const output = await msg.readAsync()
		expect(output).toContain('filename="=?UTF-8?Q?a=2Etxt?="')
		expect(output).toContain('filename="=?UTF-8?Q?b=2Etxt?="')
	})

	it('reads file attachment successfully', async () => {
		const msg = new Message({
			from: 'me',
			to: 'you',
			attachment: { path: 'package.json', name: 'package.json' },
		})
		const output = await msg.readAsync()
		expect(output).toContain('filename="=?UTF-8?Q?package=2Ejson?="')
		expect(output).toContain('ewoJ')
	})

	it('message validation fails if attachment has no data', () => {
		const msg = new Message({
			from: 'me',
			to: 'you',
			// @ts-expect-error testing invalid attachment
			attachment: [{ name: 'empty' }],
		})
		const { isValid, validationError } = msg.checkValidity()
		expect(isValid).toBe(false)
		expect(validationError).toContain('attachment has no data associated with it')
	})

	it('MessageStream handles pause and resume', async () => {
		const msg = new Message({
			from: 'me',
			to: 'you',
			text: 'content',
		})
		const stream = msg.stream()
		stream.pause()
		// @ts-expect-error accessing protected
		expect(stream.paused).toBe(true)
		stream.resume()
		// @ts-expect-error accessing protected
		expect(stream.paused).toBe(false)
	})

	it('outputs alternative content correctly', async () => {
		const msg = new Message({
			from: 'me',
			to: 'you',
			text: 'plain',
			attachment: {
				data: '<b>html</b>',
				alternative: true,
			},
		})
		const output = await msg.readAsync()
		expect(output).toContain('multipart/alternative')
		expect(output).toContain('text/plain')
		expect(output).toContain('text/html')
	})

	it('handles pause during output', () =>
		new Promise<void>((done) => {
			const msg = new Message({
				from: 'me',
				to: 'you',
				text: 'a'.repeat(100000),
			})
			const stream = msg.stream()
			let paused = false

			stream.on('data', () => {
				if (!paused) {
					stream.pause()
					paused = true
					setTimeout(() => {
						stream.resume()
					}, 10)
				}
			})

			stream.on('end', () => {
				done()
			})
		}))

	it('message validation succeeds with valid attachments', () => {
		const msg = new Message({
			from: 'me',
			to: 'you',
			attachment: [{ data: 'content' }, { path: 'package.json' }],
		})
		const { isValid, validationError } = msg.checkValidity()
		expect(isValid).toBe(true)
		expect(validationError).toBeUndefined()
	})

	it('streams buffer overflow correctly', async () => {
		const hugeText = 'a'.repeat(20000)
		const msg = new Message({
			from: 'me',
			to: 'you',
			text: hugeText,
		})
		const output = await msg.readAsync()
		expect(output).toContain(hugeText)
	})

	it('outputs headers correctly excluding BCC', async () => {
		const msg = new Message({
			from: 'me',
			to: 'you',
			bcc: 'secret',
			'X-Custom': 'value',
		})
		const output = await msg.readAsync()
		expect(output).toContain('X-Custom: value')
		expect(output).not.toContain('Bcc:')
	})
})
