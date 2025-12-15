import { describe, it, expect } from 'vitest'
import { SMTPConnection, DEFAULT_TIMEOUT } from './connection.js'

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
		expect(c.domain).toBe('example.com')
		expect(c.host).toBe('mail.example.com')
		expect(c.ssl).toBe(true)
		expect(c.tls).toBe(true)
	})

	it('throws if password provided without user', () => {
		expect(() => new SMTPConnection({ password: '123' })).toThrow(
			'`password` cannot be set without `user`'
		)
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
})
