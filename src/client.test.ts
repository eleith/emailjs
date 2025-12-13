import { describe, it, expect } from 'vitest'
import { SMTPClient } from './client.js'
import { Message } from './message.js'
import { DEFAULT_TIMEOUT } from './connection.js'

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

	it('client accepts array recipients', () => {
		const msg = new Message({
			from: 'zelda@gmail.com',
			to: ['gannon1@gmail.com'],
			cc: ['gannon2@gmail.com'],
			bcc: ['gannon3@gmail.com'],
		})

		// accessing private header for test
		msg.header.to = [msg.header.to as string]
		// accessing private header for test
		msg.header.cc = [msg.header.cc as string]
		// accessing private header for test
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
		// accessing private header for test
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
})
