import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { SMTPServer } from 'smtp-server'
import type { SMTPServerSession } from 'smtp-server'
import { SMTPClient, Message } from './index.js'
import { DEFAULT_TIMEOUT } from './connection.js'

const port = 5560

interface ExtendedSession extends SMTPServerSession {
	greylistChecked?: boolean
}

// Server instance
const server = new SMTPServer({
	secure: false,
	onAuth(auth, _session, callback) {
		if (auth.username === 'pooh' && auth.password === 'honey') {
			callback(null, { user: 'pooh' })
		} else {
			return callback(new Error('invalid user / pass'))
		}
	},
	onRcptTo(address, session, callback) {
		const extSession = session as ExtendedSession
		// Greylisting simulation
		if (address.address.endsWith('greylist') && !extSession.greylistChecked) {
			const err = new Error('greylist')
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			;(err as any).responseCode = 450
			extSession.greylistChecked = true // Mark as checked so next retry succeeds
			return callback(err)
		}
		callback()
	},
})

// Client instance
const client = new SMTPClient({
	port,
	user: 'pooh',
	password: 'honey',
	host: '127.0.0.1',
	tls: {
		rejectUnauthorized: false,
	},
})

describe('Client Integration', () => {
	beforeAll(async () => {
		return new Promise<void>((resolve) => {
			server.listen(port, '127.0.0.1', () => {
				// Prevent unhandled error events on the client socket
				client.smtp['sock']?.on('error', () => {})
				resolve()
			})
		})
	})

	afterAll(async () => {
		return new Promise<void>((resolve) => {
			client.smtp.close()
			server.close(() => resolve())
		})
	})

	it('client invokes callback exactly once for invalid connection', async () => {
		const msg = {
			from: 'foo@bar.baz',
			to: 'foo@bar.baz',
			subject: 'hello world',
			text: 'hello world',
		}

		await new Promise<void>((resolve, reject) => {
			let counter = 0
			// Connect to a closed port/invalid host
			const invalidClient = new SMTPClient({
				host: '127.0.0.1',
				port: 12345,
				timeout: 100,
			})
			const incrementCounter = () => {
				if (counter > 0) {
					reject(new Error('Callback called multiple times'))
				} else {
					counter++
				}
			}
			invalidClient.send(new Message(msg), (err) => {
				if (err == null) {
					reject(new Error('Expected error for invalid connection'))
				} else {
					incrementCounter()
				}
			})

			// Wait a bit to ensure no double callback
			setTimeout(() => {
				if (counter === 1) resolve()
				else reject(new Error('Callback not called'))
			}, 500)
		})
	})

	it('client has a default connection timeout', () => {
		const connectionOptions = {
			user: 'username',
			password: 'password',
			host: '127.0.0.1',
			port: 1234,
			timeout: undefined as number | null | undefined,
		}
		expect(new SMTPClient(connectionOptions).smtp.timeout).toBe(DEFAULT_TIMEOUT)

		connectionOptions.timeout = null
		expect(new SMTPClient(connectionOptions).smtp.timeout).toBe(DEFAULT_TIMEOUT)

		connectionOptions.timeout = undefined
		expect(new SMTPClient(connectionOptions).smtp.timeout).toBe(DEFAULT_TIMEOUT)
	})

	it('client deduplicates recipients', () => {
		const msg = {
			from: 'zelda@gmail.com',
			to: 'gannon@gmail.com',
			cc: 'gannon@gmail.com',
			bcc: 'gannon@gmail.com',
		}
		const stack = client.createMessageStack(new Message(msg))
		expect(stack.to.length).toBe(1)
		expect(stack.to[0].address).toBe('gannon@gmail.com')
	})

	it('client accepts array recipients', () => {
		const msg = new Message({
			from: 'zelda@gmail.com',
			to: ['gannon1@gmail.com'],
			cc: ['gannon2@gmail.com'],
			bcc: ['gannon3@gmail.com'],
		})

		msg.header.to = [msg.header.to as string]
		msg.header.cc = [msg.header.cc as string]
		msg.header.bcc = [msg.header.bcc as string]

		const { isValid } = msg.checkValidity()
		const stack = client.createMessageStack(msg)

		expect(isValid).toBe(true)
		expect(stack.to.length).toBe(3)
		expect(stack.to.map((x) => x.address)).toEqual([
			'gannon1@gmail.com',
			'gannon2@gmail.com',
			'gannon3@gmail.com',
		])
	})

	it('client accepts array sender', () => {
		const msg = new Message({
			from: ['zelda@gmail.com'],
			to: ['gannon1@gmail.com'],
		})
		// accessing private header for test
		msg.header.from = [msg.header.from as string]

		const { isValid } = msg.checkValidity()
		expect(isValid).toBe(true)
	})

	it('client allows message with only `cc` recipient header', async () => {
		const msg = {
			subject: 'this is a test TEXT message from emailjs',
			from: 'piglet@gmail.com',
			cc: 'pooh@gmail.com',
			text: "It is hard to be brave when you're only a Very Small Animal.",
		}

		const message = await client.sendAsync(new Message(msg))
		// We verify the message was accepted. Parsing verification is done in message.integration.test.ts
		expect(message).toBeDefined()
	})

	it('client allows message with only `bcc` recipient header', async () => {
		const msg = {
			subject: 'this is a test TEXT message from emailjs',
			from: 'piglet@gmail.com',
			bcc: 'pooh@gmail.com',
			text: "It is hard to be brave when you're only a Very Small Animal.",
		}

		const message = await client.sendAsync(new Message(msg))
		expect(message).toBeDefined()
	})

	it('client supports greylisting', async () => {
		const msg = {
			subject: 'greylist test',
			from: 'piglet@gmail.com',
			to: 'test@greylist', // Trigger greylist logic in mock server
			text: 'Testing greylisting',
		}

		// We use a fresh client for this to ensure no prior connection state
		const greylistClient = new SMTPClient({
			port,
			user: 'pooh',
			password: 'honey',
			host: '127.0.0.1',
			tls: { rejectUnauthorized: false },
		})

		// The mock server is configured to return 450 once, then accept.
		// SMTPClient handles this by retrying.
		// Note: The original test logic for greylisting was complex with mocking internal onRcptTo.
		// Here we simulated it via server config above.

		// However, since we share the server, we need to be careful.
		// The server logic above uses `session.greylistChecked`.

		// This might fail if the retry logic isn't triggered or server state isn't reset.
		// Let's rely on SMTPClient's built-in retry.

		await expect(
			greylistClient.sendAsync(new Message(msg))
		).resolves.toBeDefined()
		greylistClient.smtp.close()
	})
})
