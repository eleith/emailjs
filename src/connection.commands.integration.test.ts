import { describe, it, beforeAll, afterAll } from 'vitest'
import { SMTPServer } from 'smtp-server'
import { SMTPConnection } from './connection.js'

const PORT = 5562

describe('SMTPConnection (Extended Commands)', () => {
	let server: SMTPServer

	beforeAll(async () => {
		server = new SMTPServer({
			secure: false,
			authOptional: true,
		})
		await new Promise<void>((resolve) => {
			server.listen(PORT, '127.0.0.1', () => resolve())
		})
	})

	afterAll(async () => {
		await new Promise<void>((resolve) => {
			server.close(resolve)
		})
	})

	it('sends VRFY', async () => {
		const conn = new SMTPConnection({ port: PORT, host: '127.0.0.1' })
		await new Promise<void>((resolve, reject) => {
			conn.connect((err) => {
				if (err) return reject(err)
				conn.verify('user', (err) => {
					if (err) reject(err)
					else resolve()
				})
			})
		})
		conn.close()
	})

	it('sends MAIL and RCPT', async () => {
		const conn = new SMTPConnection({ port: PORT, host: '127.0.0.1' })
		await new Promise<void>((resolve, reject) => {
			conn.connect((err) => {
				if (err) return reject(err)
				// Must send HELO/EHLO first
				conn.helo((err) => {
					if (err) return reject(err)
					conn.mail((err) => {
						if (err) return reject(err)
						conn.rcpt(
							(err) => {
								if (err) reject(err)
								else resolve()
							},
							'<user@example.com>'
						)
					}, '<me@example.com>')
				})
			})
		})
		conn.close()
	})

	// EXPN often returns 502 Not Implemented
	it('sends EXPN (handles error/response)', async () => {
		const conn = new SMTPConnection({ port: PORT, host: '127.0.0.1' })
		await new Promise<void>((resolve) => {
			conn.connect((err) => {
				if (err) throw err
				conn.expn('list', () => {
					// We expect it to be sent, result depends on server support
					// Just verifying it calls back
					resolve()
				})
			})
		})
		conn.close()
	})
})
