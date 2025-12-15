import { createReadStream, readFileSync } from 'fs'
import { URL } from 'url'
import { resolve } from 'path'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { simpleParser } from 'mailparser'
import type { AddressObject, ParsedMail } from 'mailparser'
import { SMTPServer } from 'smtp-server'

import { SMTPClient, Message } from './index.js'
import type { MessageAttachment, MessageHeaders } from './index.js'

// Resolve paths to fixtures relative to the project root
const FIXTURES_DIR = resolve('test/attachments')

// Generate a large text fixture (~200KB) instead of reading the 5MB file
// This is sufficient to test chunking/buffering without slowing down tests
const textFixture = '0123456789'.repeat(20 * 1024)

const htmlFixtureUrl = new URL(`file://${resolve(FIXTURES_DIR, 'smtp.html')}`)
const htmlFixture = readFileSync(htmlFixtureUrl, 'utf-8')

const pdfFixtureUrl = new URL(`file://${resolve(FIXTURES_DIR, 'smtp.pdf')}`)
const pdfFixture = readFileSync(pdfFixtureUrl, 'base64')

const tarFixtureUrl = new URL(
	`file://${resolve(FIXTURES_DIR, 'postfix-2.8.7.tar.gz')}`
)
const tarFixture = readFileSync(tarFixtureUrl, 'base64')

type ParsedMailCompat = Omit<ParsedMail, 'to'> & { to?: AddressObject }

const port = 5559 // Increment port
const parseMap = new Map<string, ParsedMailCompat>()

// Create server instance
const server = new SMTPServer({
	secure: false, // Use STARTTLS
	onAuth(auth, _session, callback) {
		if (auth.username == 'pooh' && auth.password == 'honey') {
			callback(null, { user: 'pooh' })
		} else {
			return callback(new Error('invalid user / pass'))
		}
	},
	async onData(stream, _session, callback) {
		try {
			const mail = (await simpleParser(stream, {
				skipHtmlToText: true,
				skipTextToHtml: true,
				skipImageLinks: true,
			} as Record<string, unknown>)) as ParsedMailCompat

			parseMap.set(mail.subject as string, mail)
			callback()
		} catch (err) {
			callback(err as Error)
		}
	},
})

// Client instance
const client = new SMTPClient({
	port,
	user: 'pooh',
	password: 'honey',
	host: '127.0.0.1',
	// ssl default is false
	tls: {
		rejectUnauthorized: false,
	},
})

async function send(headers: Partial<MessageHeaders>) {
	return new Promise<ParsedMailCompat>((resolve, reject) => {
		try {
			client.send(new Message(headers), (err) => {
				if (err) {
					reject(err)
				} else {
					const start = Date.now()
					const checkMap = () => {
						const mail = parseMap.get(headers.subject as string)
						if (mail) {
							resolve(mail)
						} else {
							if (Date.now() - start > 2000) {
								reject(new Error('Timed out waiting for email to be parsed'))
							} else {
								setTimeout(checkMap, 50)
							}
						}
					}
					checkMap()
				}
			})
		} catch (e) {
			reject(e)
		}
	})
}

describe('Message Integration', () => {
	beforeAll(async () => {
		return new Promise<void>((resolve) => {
			server.listen(port, '127.0.0.1', () => {
				client.smtp['sock']?.on('error', () => { })
				resolve()
			})
		})
	})

	afterAll(async () => {
		return new Promise<void>((resolve) => {
			// Close client connection first
			client.smtp.close()
			server.close(() => resolve())
		})
	})

	it('simple text message', async () => {
		const msg = {
			subject: 'this is a test TEXT message from emailjs',
			from: 'zelda@gmail.com',
			to: 'gannon@gmail.com',
			cc: 'gannon@gmail.com',
			bcc: 'gannon@gmail.com',
			text: 'hello friend, i hope this message finds you well.',
			'message-id': 'this is a special id',
		}

		const mail = await send(msg)
		expect(mail.text).toBe(msg.text + '\n\n\n')
		expect(mail.subject).toBe(msg.subject)
		expect(mail.from?.text).toBe(msg.from)
		expect(mail.to?.text).toBe(msg.to)
		expect(mail.messageId).toBe('<' + msg['message-id'] + '>')
	})

	it('null text message', async () => {
		const msg = {
			subject: 'this is a test TEXT message from emailjs',
			from: 'zelda@gmail.com',
			to: 'gannon@gmail.com',
			text: null,
			'message-id': 'this is a special id',
		}

		const mail = await send(msg)
		expect(mail.text).toBe('\n\n\n')
	})

	it('empty text message', async () => {
		const msg = {
			subject: 'this is a test TEXT message from emailjs',
			from: 'zelda@gmail.com',
			to: 'gannon@gmail.com',
			text: '',
			'message-id': 'this is a special id',
		}

		const mail = await send(msg)
		expect(mail.text).toBe('\n\n\n')
	})

	it('simple unicode text message', async () => {
		const msg = {
			subject: 'this ✓ is a test ✓ TEXT message from emailjs',
			from: 'zelda✓ <zelda@gmail.com>',
			to: 'gannon✓ <gannon@gmail.com>',
			text: 'hello ✓ friend, i hope this message finds you well.',
		}

		const mail = await send(msg)
		expect(mail.text).toBe(msg.text + '\n\n\n')
		expect(mail.subject).toBe(msg.subject)
		expect(mail.from?.text).toBe(msg.from.replace('zelda✓', '"zelda✓"'))
		expect(mail.to?.text).toBe(msg.to.replace('gannon✓', '"gannon✓"'))
	})
	it('very large text message', async () => {
		const msg = {
			subject: 'this is a test TEXT message from emailjs',
			from: 'ninjas@gmail.com',
			to: 'pirates@gmail.com',
			text: textFixture,
		}

		const mail = await send(msg)
		expect(mail.text).toBe(msg.text.replace(/\r/g, '') + '\n\n\n')
		expect(mail.subject).toBe(msg.subject)
		expect(mail.from?.text).toBe(msg.from)
		expect(mail.to?.text).toBe(msg.to)
	})

	it('very large text data message', async () => {
		const text = '<html><body><pre>' + textFixture + '</pre></body></html>'

		const msg = {
			subject: 'this is a test TEXT+DATA message from emailjs',
			from: 'lobsters@gmail.com',
			to: 'lizards@gmail.com',
			text: 'hello friend if you are seeing this, you can not view html emails. it is attached inline.',
			attachment: {
				data: text,
				alternative: true,
			},
		}

		const mail = await send(msg)
		expect(mail.html).toBe(text.replace(/\r/g, ''))
		expect(mail.text).toBe(msg.text + '\n')
		expect(mail.subject).toBe(msg.subject)
		expect(mail.from?.text).toBe(msg.from)
		expect(mail.to?.text).toBe(msg.to)
	})

	it('html data message', async () => {
		const msg = {
			subject: 'this is a test TEXT+HTML+DATA message from emailjs',
			from: 'obama@gmail.com',
			to: 'mitt@gmail.com',
			attachment: {
				data: htmlFixture,
				alternative: true,
			},
		}

		const mail = await send(msg)
		expect(mail.html).toBe(htmlFixture.replace(/\r/g, ''))
		expect(mail.text).toBe('\n')
		expect(mail.subject).toBe(msg.subject)
		expect(mail.from?.text).toBe(msg.from)
		expect(mail.to?.text).toBe(msg.to)
	})

	it('html file message', async () => {
		const msg = {
			subject: 'this is a test TEXT+HTML+FILE message from emailjs',
			from: 'thomas@gmail.com',
			to: 'nikolas@gmail.com',
			attachment: {
				path: htmlFixtureUrl,
				alternative: true,
			},
		}

		const mail = await send(msg)
		expect(mail.html).toBe(htmlFixture.replace(/\r/g, ''))
		expect(mail.text).toBe('\n')
		expect(mail.subject).toBe(msg.subject)
		expect(mail.from?.text).toBe(msg.from)
		expect(mail.to?.text).toBe(msg.to)
	})

	it('html with image embed message', async () => {
		const htmlFixture2Url = new URL(
			`file://${resolve(FIXTURES_DIR, 'smtp2.html')}`
		)
		const imageFixtureUrl = new URL(
			`file://${resolve(FIXTURES_DIR, 'smtp.gif')}`
		)
		const msg = {
			subject: 'this is a test TEXT+HTML+IMAGE message from emailjs',
			from: 'ninja@gmail.com',
			to: 'pirate@gmail.com',
			attachment: {
				path: htmlFixture2Url,
				alternative: true,
				related: [
					{
						path: imageFixtureUrl,
						type: 'image/gif',
						name: 'smtp-diagram.gif',
						headers: { 'Content-ID': '<smtp-diagram@local>' },
					},
				],
			},
		}

		const mail = await send(msg)
		if (mail.attachments) {
			expect(mail.attachments[0].content.toString('base64')).toBe(
				readFileSync(imageFixtureUrl, 'base64')
			)
		} else {
			throw new Error('Attachments missing')
		}
		expect(mail.html).toBe(
			readFileSync(htmlFixture2Url, 'utf-8').replace(/\r/g, '')
		)
		expect(mail.text).toBe('\n')
		expect(mail.subject).toBe(msg.subject)
		expect(mail.from?.text).toBe(msg.from)
		expect(mail.to?.text).toBe(msg.to)
	})

	it('html data and attachment message', async () => {
		const msg = {
			subject: 'this is a test TEXT+HTML+FILE message from emailjs',
			from: 'thomas@gmail.com',
			to: 'nikolas@gmail.com',
			attachment: [
				{
					path: htmlFixtureUrl,
					alternative: true,
				},
				{
					path: new URL(`file://${resolve(FIXTURES_DIR, 'smtp.gif')}`),
				},
			] as MessageAttachment[],
		}

		const mail = await send(msg)
		expect(mail.html).toBe(htmlFixture.replace(/\r/g, ''))
		expect(mail.text).toBe('\n')
		expect(mail.subject).toBe(msg.subject)
		expect(mail.from?.text).toBe(msg.from)
		expect(mail.to?.text).toBe(msg.to)
	})

	it('attachment message', async () => {
		const msg = {
			subject: 'this is a test TEXT+ATTACHMENT message from emailjs',
			from: 'washing@gmail.com',
			to: 'lincoln@gmail.com',
			text: 'hello friend, i hope this message and pdf finds you well.',
			attachment: {
				path: pdfFixtureUrl,
				type: 'application/pdf',
				name: 'smtp-info.pdf',
			} as MessageAttachment,
		}

		const mail = await send(msg)
		if (mail.attachments) {
			expect(mail.attachments[0].content.toString('base64')).toBe(pdfFixture)
		} else {
			throw new Error('Attachments missing')
		}
		expect(mail.text).toBe(msg.text + '\n')
		expect(mail.subject).toBe(msg.subject)
		expect(mail.from?.text).toBe(msg.from)
		expect(mail.to?.text).toBe(msg.to)
	})

	it('attachment sent with unicode filename message', async () => {
		const msg = {
			subject: 'this is a test TEXT+ATTACHMENT message from emailjs',
			from: 'washing@gmail.com',
			to: 'lincoln@gmail.com',
			text: 'hello friend, i hope this message and pdf finds you well.',
			attachment: {
				path: pdfFixtureUrl,
				type: 'application/pdf',
				name: 'smtp-✓-info.pdf',
			} as MessageAttachment,
		}

		const mail = await send(msg)
		if (mail.attachments) {
			expect(mail.attachments[0].content.toString('base64')).toBe(pdfFixture)
			expect(mail.attachments[0].filename).toBe('smtp-✓-info.pdf')
		} else {
			throw new Error('Attachments missing')
		}
		expect(mail.text).toBe(msg.text + '\n')
		expect(mail.subject).toBe(msg.subject)
		expect(mail.from?.text).toBe(msg.from)
		expect(mail.to?.text).toBe(msg.to)
	})

	it('attachments message', async () => {
		const msg = {
			subject: 'this is a test TEXT+2+ATTACHMENTS message from emailjs',
			from: 'sergey@gmail.com',
			to: 'jobs@gmail.com',
			text: 'hello friend, i hope this message and attachments finds you well.',
			attachment: [
				{
					path: pdfFixtureUrl,
					type: 'application/pdf',
					name: 'smtp-info.pdf',
				},
				{
					path: tarFixtureUrl,
					type: 'application/tar-gz',
					name: 'postfix.source.2.8.7.tar.gz',
				},
			] as MessageAttachment[],
		}

		const mail = await send(msg)
		if (mail.attachments) {
			expect(mail.attachments[0].content.toString('base64')).toBe(pdfFixture)
			expect(mail.attachments[1].content.toString('base64')).toBe(tarFixture)
		} else {
			throw new Error('Attachments missing')
		}
		expect(mail.text).toBe(msg.text + '\n')
		expect(mail.subject).toBe(msg.subject)
		expect(mail.from?.text).toBe(msg.from)
		expect(mail.to?.text).toBe(msg.to)
	})

	it('streams message', async () => {
		const msg = {
			subject:
				'this is a test TEXT+2+STREAMED+ATTACHMENTS message from emailjs',
			from: 'stanford@gmail.com',
			to: 'mit@gmail.com',
			text: 'hello friend, i hope this message and streamed attachments finds you well.',
			attachment: [
				{
					stream: createReadStream(pdfFixtureUrl),
					type: 'application/pdf',
					name: 'smtp-info.pdf',
				},
				{
					stream: createReadStream(tarFixtureUrl),
					type: 'application/x-gzip',
					name: 'postfix.source.2.8.7.tar.gz',
				},
			],
		}

		// ensure streams are paused (mimic behavior in old tests or usage)
		if (Array.isArray(msg.attachment)) {
			for (const att of msg.attachment) {
				if (att.stream) {
					att.stream.pause()
				}
			}
		}

		const mail = await send(msg)
		if (mail.attachments) {
			expect(mail.attachments[0].content.toString('base64')).toBe(pdfFixture)
			expect(mail.attachments[1].content.toString('base64')).toBe(tarFixture)
		} else {
			throw new Error('Attachments missing')
		}
		expect(mail.text).toBe(msg.text + '\n')
		expect(mail.subject).toBe(msg.subject)
		expect(mail.from?.text).toBe(msg.from)
		expect(mail.to?.text).toBe(msg.to)
	})
})
