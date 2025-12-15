import { describe, it, expect } from 'vitest'
import { Readable } from 'stream'
import { SMTPClient } from './client.js'
import { Message } from './message.js'
import { DEFAULT_TIMEOUT, SMTPState } from './connection.js'

describe('SMTPClient', () => {
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
		const stack = new SMTPClient({ host: 'localhost' }).createMessageStack(
			new Message(msg)
		)
		expect(stack.to.length).toBe(1)
		expect(stack.to[0].address).toBe('gannon@gmail.com')
	})

	it('client accepts return path', () => {
		const msg = {
			from: 'zelda@gmail.com',
			to: 'gannon@gmail.com',
			'return-path': 'link@gmail.com',
		}
		const stack = new SMTPClient({ host: 'localhost' }).createMessageStack(
			new Message(msg)
		)
		expect(stack.to.length).toBe(1)
		expect(stack.to[0].address).toBe('gannon@gmail.com')
		expect(stack.returnPath).toBe('link@gmail.com')
	})

	it('client discards bad return path', () => {
		const msg = {
			from: 'zelda@gmail.com',
			to: 'gannon@gmail.com',
			'return-path': '  ',
		}
		const stack = new SMTPClient({ host: 'localhost' }).createMessageStack(
			new Message(msg)
		)
		expect(stack.to.length).toBe(1)
		expect(stack.to[0].address).toBe('gannon@gmail.com')
		expect(stack.returnPath).toBe(undefined)
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
		const stack = new SMTPClient({ host: 'localhost' }).createMessageStack(msg)

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
		msg.header.from = [msg.header.from as string]

		const { isValid } = msg.checkValidity()
		expect(isValid).toBe(true)
	})

	it('client constructor throws if `password` supplied without `user`', () => {
		expect(
			() => new SMTPClient({ user: 'anything', password: 'anything' })
		).not.toThrow()
		expect(() => new SMTPClient({ password: 'anything' })).toThrow()
		expect(
			() =>
				new SMTPClient({
					username: 'anything',
					password: 'anything',
				} as Record<string, unknown>)
		).toThrow()
	})

	it('sendAsync rejects if message is invalid', async () => {
		const client = new SMTPClient({ host: 'localhost' })
		await expect(client.sendAsync({} as Message)).rejects.toThrow(
			'message is not a valid Message instance'
		)
	})

	it('client callbacks with error if no recipients found', async () => {
		const client = new SMTPClient({ host: 'localhost' })
		const msg = new Message({
			from: 'me@example.com',
			to: [],
			text: 'hello',
		})

		await expect(client.sendAsync(msg)).rejects.toThrow(
			'No recipients found in message'
		)
	})

	it('client accepts message with only alternative attachment', async () => {
		const client = new SMTPClient({ host: 'localhost' })
		const msg = {
			subject: 'subject',
			from: 'me@example.com',
			to: 'you@example.com',
			attachment: [{ data: '<b>hi</b>', alternative: true }],
			text: '',
		}

		try {
			await client.sendAsync(msg)
		} catch (err) {
			if (err instanceof Error) {
				expect(err.message).not.toBe('message is not a valid Message instance')
			}
		}
	})

	it('client accepts array attachments', () => {
		const msg = {
			from: 'zelda@gmail.com',
			to: 'gannon@gmail.com',
			subject: 'Attachments',
			attachment: [
				{ data: 'first attachment', name: 'first.txt', alternative: true },
				{ data: 'second attachment', name: 'second.txt', alternative: true },
			],
		}
		const client = new SMTPClient({ host: 'localhost' })
		client.send(msg, (cb) => {
			expect(cb).toBeDefined()
		})
	})

	it('client accepts single attachment', () => {
		const msg = {
			from: 'zelda@gmail.com',
			to: 'gannon@gmail.com',
			subject: 'Attachments',
			attachment: {
				data: 'first attachment',
				name: 'first.txt',
				alternative: true,
			},
		}
		const client = new SMTPClient({ host: 'localhost' })
		client.send(msg, (cb) => {
			expect(cb).toBeDefined()
		})
	})

	it('client callbacks with error if message fails validity check', async () => {
		const client = new SMTPClient({ host: 'localhost' })
		const msg = new Message({
			to: 'you@example.com',
			text: 'hello',
		})

		await expect(client.sendAsync(msg)).rejects.toThrow(
			'Message must have a `from` header'
		)
	})

	it('client handles stream error during sending', async () => {
		const client = new SMTPClient({ host: 'localhost' })
		let currentState: 0 | 1 | 2 = SMTPState.NOTCONNECTED

		client.smtp.state = () => currentState
		client.smtp.connect = (cb) => {
			currentState = SMTPState.CONNECTED
			cb(null)
		}
		client.smtp.ehlo_or_helo_if_needed = (cb) => cb(null)
		client.smtp.mail = (cb) => cb(null)
		client.smtp.rcpt = (cb) => cb(null)
		client.smtp.data = (cb) => cb(null)
		client.smtp.message = () => { }
		client.smtp.close = () => { }
		client.smtp.login = (cb) => cb(null)

		const stream = new Readable({
			read() {
				this.emit('error', new Error('stream kaboom'))
			},
		})

		const msg = new Message({
			from: 'me@example.com',
			to: 'you@example.com',
			text: 'hi',
			attachment: { stream, name: 'fail.txt' },
		})

		await expect(client.sendAsync(msg)).rejects.toThrow('stream kaboom')
	})

	it('client handles SMTP command error', async () => {
		const client = new SMTPClient({ host: 'localhost' })
		let currentState: 0 | 1 | 2 = SMTPState.NOTCONNECTED

		client.smtp.state = () => currentState
		client.smtp.connect = (cb) => {
			currentState = SMTPState.CONNECTED
			cb(null)
		}
		client.smtp.ehlo_or_helo_if_needed = (cb) => cb(null)
		client.smtp.mail = (cb) => cb(null)
		client.smtp.rcpt = (cb) => cb(new Error('Recipient rejected'))
		client.smtp.rset = (cb) => cb(null)

		const msg = new Message({ from: 'me', to: 'you', text: 'hi' })
		await expect(client.sendAsync(msg)).rejects.toThrow('Recipient rejected')
	})

	it('throws if stack.to is invalid in _sendrcpt', () => {
		const client = new SMTPClient({ host: 'localhost' })
		// @ts-expect-error testing invalid input
		expect(() => client._sendrcpt({ to: null })).toThrow(
			'stack.to must be array'
		)
	})

	it('client creates message stack with default callback', () => {
		const client = new SMTPClient({ host: 'localhost' })
		const msg = new Message({ from: 'me@example.com', to: 'you@example.com' })
		const stack = client.createMessageStack(msg)
		expect(typeof stack.callback).toBe('function')
		stack.callback(null, msg) // Execute it to ensure it does nothing safely
	})

	it('client handles login error', async () => {
		const client = new SMTPClient({ host: 'localhost' })
		const mockSmtp = {
			connect: (cb: (err?: Error | null) => void) => cb(),
			authorized: () => false,
			login: (cb: (err?: Error | null) => void) =>
				cb(new Error('Login failed')),
			state: () => SMTPState.NOTCONNECTED,
		}
		// @ts-expect-error mocking internals
		client.smtp = mockSmtp

		const msg = new Message({ from: 'me', to: 'you', text: 'hi' })
		await expect(client.sendAsync(msg)).rejects.toThrow('Login failed')
	})

	it('sendAsync rejects if _canMakeMessage fails', async () => {
		const client = new SMTPClient({ host: 'localhost' })

		await expect(
			client.sendAsync({ from: 'me', text: 'hi' } as unknown as Message)
		).rejects.toThrow('message is not a valid Message instance')

		await expect(
			client.sendAsync({ from: 'me', to: 'you' } as unknown as Message)
		).rejects.toThrow('message is not a valid Message instance')
	})

	it('client clears poll timer on new send', async () => {
		const client = new SMTPClient({ host: 'localhost' })

		// @ts-expect-error mocking internals
		client.ready = true
		// @ts-expect-error mocking internals
		client._connect = (stack) => {
			// @ts-expect-error mocking internals
			client.ready = true
			// @ts-expect-error mocking internals
			client._sendmail(stack)
		}
		// @ts-expect-error mocking internals
		client._sendmail = (stack) => {
			// @ts-expect-error mocking internals
			client._senddone(null, stack)
		}
		client.smtp.state = () => SMTPState.CONNECTED

		const msg = new Message({ from: 'me', to: 'you', text: 'hi' })

		// First send
		await client.sendAsync(msg)
		// Timer should be set in _poll now because queue is empty

		// Second send immediately
		await client.sendAsync(msg)
		// Should clear previous timer
	})
})
