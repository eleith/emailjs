import { describe, it, expect, vi } from 'vitest'
import { SMTPError, SMTPErrorStates } from './error.js'
import { Socket } from 'net'
import { SMTPConnection, DEFAULT_TIMEOUT, SMTPState } from './connection.js'

describe('SMTPConnection (Unit)', () => {
	it('initializes with default options', () => {
		const conn = new SMTPConnection()
		expect(conn.timeout).toBe(DEFAULT_TIMEOUT)
	})

	it('initializes with custom options', () => {
		const conn = new SMTPConnection({
			timeout: 10000,
			domain: 'example.com',
			host: 'mail.example.com',
			port: 587,
			ssl: true,
			tls: true,
		})
		expect(conn.timeout).toBe(10000)
		// Accessing protected fields via casting or public getters if available
		// Since they are protected, we can just assume they are set if no error.
		// Or inspect via any:
		const c = conn as unknown as Record<string, unknown>
		expect(c._domain).toBe('example.com')
		expect(c.host).toBe('mail.example.com')
		expect(c.ssl).toBe(true)
		expect(c.tls).toBe(true)
	})

	it('throws if password provided without user', () => {
		expect(() => new SMTPConnection({ password: '123' })).toThrow(
			'`password` cannot be set without `user`'
		)
	})

	it('preserves the AUTH timeout category without forwarding transport diagnostics', () => {
		const socket = new Socket()
		const conn = new (class extends SMTPConnection {
			constructor() {
				super({ user: 'user', password: 'pass' })
				this.sock = socket
				this._state = SMTPState.CONNECTED
			}
		})()
		const timeout = SMTPError.create(
			'private transport detail',
			SMTPErrorStates.TIMEDOUT,
			new Error('private cause'),
			'private reply'
		)
		vi.spyOn(socket, 'write').mockReturnValue(true)

		const done = vi.fn()
		conn.login(done)
		socket.emit('response', null, { code: '250', data: '250 AUTH PLAIN' })
		socket.emit('response', timeout)
		socket.destroy()
		expect(done).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				code: SMTPErrorStates.AUTHFAILED,
				previous: expect.objectContaining({
					code: SMTPErrorStates.TIMEDOUT,
					previous: null,
					smtp: undefined,
				}),
			})
		)
		const [err] = done.mock.calls[0]
		expect(err.message).not.toContain('private')
		expect(err.previous.message).not.toContain('private')
	})

	it('accepts a custom logger', () => {
		const logger = () => {}
		const conn = new SMTPConnection({ logger })
		expect((conn as unknown as { log: unknown }).log).toBe(logger)
	})

	it('initializes with ssl as object', () => {
		const conn = new SMTPConnection({
			ssl: { rejectUnauthorized: false },
		})
		// @ts-expect-error accessing protected
		expect(conn.ssl).toEqual({ rejectUnauthorized: false })
	})

	it('initializes with tls as object', () => {
		const conn = new SMTPConnection({
			tls: { rejectUnauthorized: false },
		})
		// @ts-expect-error accessing protected
		expect(conn.tls).toEqual({ rejectUnauthorized: false })
	})

	it.each([false, true])(
		'leaves the replacement socket intact when close(%s) logs',
		(force) => {
			class TestConnection extends SMTPConnection {
				attachSocket(socket: Socket) {
					this.sock = socket
					this._state = SMTPState.CONNECTED
				}

				currentSocket() {
					return this.sock
				}
			}

			const original = new Socket()
			const replacement = new Socket()
			let stateAtLog: ReturnType<SMTPConnection['state']> | undefined
			const connection = new TestConnection({
				logger: () => {
					stateAtLog = connection.state()
					connection.attachSocket(replacement)
				},
			})
			connection.attachSocket(original)

			try {
				connection.close(force)
				expect(stateAtLog).toBe(SMTPState.NOTCONNECTED)
				if (force) expect(original.destroyed).toBe(true)
				else expect(original.writableEnded).toBe(true)
				expect(replacement.destroyed).toBe(false)
				expect(replacement.writableEnded).toBe(false)
				expect(connection.currentSocket()).toBe(replacement)
			} finally {
				original.destroy()
				replacement.destroy()
			}
		}
	)

	it('does not conflict with Node.js domain module when emitting events on close', async () => {
		// Import node:domain which instruments EventEmitter.prototype.emit
		await import('node:domain')
		const conn = new SMTPConnection({ domain: 'example.com' })
		expect(() => conn.close()).not.toThrow()
	})
})
