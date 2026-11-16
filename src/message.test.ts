import { describe, it, expect } from 'vitest'
import { Readable } from 'stream'
import { simpleParser } from 'mailparser'
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
			text: 'hi',
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

	describe('Subject folding', () => {
		function subjectLines(output: string) {
			const match = output.match(/^Subject:.*(?:\r\n[ \t].*)*/m)
			if (match === null) {
				throw new Error('Missing Subject header')
			}
			return match[0].split('\r\n')
		}

		it.each([
			['ASCII', 'Deployment window confirmed '.repeat(45)],
			['multilingual', '京都の配達予定 '.repeat(24)],
			['supplementary characters', 'Signal 𝄢 ready '.repeat(30)],
		])(
			'folds long %s subjects without changing their text',
			async (_label, subject) => {
				const msg = new Message({
					from: 'sender@origin.test',
					to: 'reader@delivery.test',
					subject,
					text: 'Local regression fixture',
				})
				const encoded = msg.header.subject
				const output = await msg.readAsync()
				const lines = subjectLines(output)

				expect(lines.length).toBeGreaterThan(1)
				expect(lines.every((line) => line.length <= 76)).toBe(true)
				expect(
					lines.slice(1).every((line) => line.startsWith(' =?UTF-8?Q?'))
				).toBe(true)
				const unfoldedSubject = lines.join('').slice('Subject: '.length)
				expect(unfoldedSubject).toBe(encoded)
				expect(msg.header.subject).toBe(encoded)
				expect(encoded).not.toContain('\r\n')
				expect((await simpleParser(output)).subject).toBe(subject)
			}
		)

		it.each(['', 'Board approval', 'Résumé accepté'])(
			'preserves an unfolded short subject: %s',
			async (subject) => {
				const msg = new Message({
					from: 'sender@origin.test',
					to: 'reader@delivery.test',
					subject,
				})
				expect(subjectLines(await msg.readAsync())).toEqual([
					`Subject: ${msg.header.subject}`,
				])
			}
		)

		it.each([
			['cd', false],
			['cde', true],
		] as const)(
			'accounts for the header prefix at the folding boundary: %s',
			async (suffix, folded) => {
				const msg = new Message({
					from: 'sender@origin.test',
					to: 'reader@delivery.test',
				})
				const first = `=?UTF-8?Q?${'a'.repeat(40)}?=`
				const second = `=?UTF-8?Q?${suffix}?=`
				msg.header.subject = `${first} ${second}`

				const output = await msg.readAsync()
				const lines = subjectLines(output)
				expect(lines).toEqual(
					folded
						? [`Subject: ${first}`, ` ${second}`]
						: [`Subject: ${first} ${second}`]
				)
				expect(lines.every((line) => line.length <= 76)).toBe(true)
				expect((await simpleParser(output)).subject).toBe(
					'a'.repeat(40) + suffix
				)
			}
		)

		it.each(['\r\n', '\r', '\n'])(
			'sanitizes modified subjects before adding trusted folds: %j',
			async (newline) => {
				const msg = new Message({
					from: 'sender@origin.test',
					to: 'reader@delivery.test',
					subject: 'Routine receipt confirmation '.repeat(12),
				})
				msg.header.subject += `${newline}Bcc: hidden@injection.test`

				const output = await msg.readAsync()
				expect(subjectLines(output).length).toBeGreaterThan(1)
				expect(output).not.toMatch(/^Bcc:/m)
				expect((await simpleParser(output)).bcc).toBeUndefined()
			}
		)

		it('leaves unrelated header folding unchanged', async () => {
			const note = 'Review status '.repeat(30)
			const msg = new Message({
				from: 'sender@origin.test',
				to: 'reader@delivery.test',
				subject: 'Routine update',
				'x-note': note,
			})
			expect(await msg.readAsync()).toContain(`X-Note: ${note}\r\n`)
		})
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
			attachment: { path: 'test/attachments/smtp.txt', name: 'smtp.txt' },
		})
		const output = await msg.readAsync()
		expect(output).toContain('filename="=?UTF-8?Q?smtp=2Etxt?="')
	})

	it('message validation fails if attachment has no data', () => {
		const msg = new Message({
			from: 'me',
			to: 'you',
			attachment: [{ name: 'empty' }],
		})
		const { isValid, validationError } = msg.checkValidity()
		expect(isValid).toBe(false)
		expect(validationError).toContain(
			'attachment has no data associated with it'
		)
	})

	it('MessageStream handles pause and resume', async () => {
		const msg = new Message({
			from: 'me',
			to: 'you',
			text: 'content',
		})
		const stream = msg.stream()
		stream.pause()
		expect(stream.paused).toBe(true)
		stream.resume()
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
			attachment: [{ data: 'content' }, { path: 'test/attachments/smtp.txt' }],
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

	it('strips CRLF from custom header values to prevent header injection', async () => {
		const msg = new Message({
			from: 'sender@example.com',
			to: 'recipient@example.com',
			subject: 'Test',
			text: 'Hello',
			'x-custom': 'benign\r\nBcc: injected@evil.com',
		})
		const output = await msg.readAsync()
		expect(output).toContain('X-Custom: benignBcc: injected@evil.com')
		expect(output).not.toMatch(/^Bcc:/m)
	})

	it('strips lone CR and LF from custom header values', async () => {
		const msg = new Message({
			from: 'sender@example.com',
			to: 'recipient@example.com',
			text: 'Hello',
			'x-test': 'value1\rReply-To: evil@example.com',
		})
		const output = await msg.readAsync()
		expect(output).not.toMatch(/^Reply-To:/m)
	})

	it('strips CRLF from header values set after construction', async () => {
		const msg = new Message({
			from: 'sender@example.com',
			to: 'recipient@example.com',
			text: 'Hello',
		})
		// Simulate programmatic header injection after construction
		msg.header['x-injected'] = 'safe\r\nBcc: hacker@evil.com'
		const output = await msg.readAsync()
		expect(output).not.toMatch(/^Bcc:/m)
	})
})
