import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { SMTPServer } from 'smtp-server'
import { SMTPConnection, SMTPState } from './connection.js'

const PORT = 5561 // Use a different port to avoid conflicts

describe('SMTPConnection (Integration)', () => {
	let server: SMTPServer

	beforeAll(async () => {
		server = new SMTPServer({
			secure: false,
			authOptional: true, // Allow connection without auth for basic tests
			onAuth(auth, _session, callback) {
				if (auth.username === 'user' && auth.password === 'pass') {
					callback(null, { user: 'user' })
				} else {
					callback(new Error('Invalid username or password'))
				}
			},
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

	it('connects to the server', async () => {
		const conn = new SMTPConnection({
			port: PORT,
			host: '127.0.0.1',
			tls: { rejectUnauthorized: false },
		})

		await new Promise<void>((resolve, reject) => {
			conn.connect((err) => {
				if (err) reject(err)
				else {
					expect(conn.state()).toBe(SMTPState.CONNECTED)
					resolve()
				}
			})
		})
		conn.close()
	})

	it('authenticates using PLAIN', async () => {
		const conn = new SMTPConnection({
			port: PORT,
			host: '127.0.0.1',
			tls: { rejectUnauthorized: false },
			authentication: ['PLAIN'],
		})

		await new Promise<void>((resolve, reject) => {
			conn.connect((err) => {
				if (err) return reject(err)
				conn.login(
					(err) => {
						if (err) reject(err)
						else resolve()
					},
					'user',
					'pass'
				)
			})
		})
		conn.close()
	})

	it('authenticates using LOGIN', async () => {
		const conn = new SMTPConnection({
			port: PORT,
			host: '127.0.0.1',
			tls: { rejectUnauthorized: false },
			authentication: ['LOGIN'],
		})

		await new Promise<void>((resolve, reject) => {
			conn.connect((err) => {
				if (err) return reject(err)
				conn.login(
					(err) => {
						if (err) reject(err)
						else resolve()
					},
					'user',
					'pass'
				)
			})
		})
		conn.close()
	})

	it('upgrades with starttls', async () => {
		const conn = new SMTPConnection({
			port: PORT,
			host: '127.0.0.1',
			tls: { rejectUnauthorized: false },
		})

		await new Promise<void>((resolve, reject) => {
			conn.connect((err) => {
				if (err) return reject(err)
				conn.starttls((err) => {
					if (err) reject(err)
					else {
						expect(conn.state()).toBe(SMTPState.CONNECTED)
						resolve()
					}
				})
			})
		})
		conn.close()
	})

	it('fails authentication with wrong credentials', async () => {
		const conn = new SMTPConnection({
			port: PORT,
			host: '127.0.0.1',
			tls: { rejectUnauthorized: false },
		})

		await new Promise<void>((resolve, reject) => {
			conn.connect((err) => {
				if (err) return reject(err)
				conn.login(
					(err) => {
						if (err) {
							expect(err.message).toContain('authorization.failed')
							resolve()
						} else {
							reject(new Error('Should have failed'))
						}
					},
					'user',
					'wrong'
				)
			})
		})
		conn.close()
	})

	it('quits the connection', async () => {
		const conn = new SMTPConnection({
			port: PORT,
			host: '127.0.0.1',
			tls: { rejectUnauthorized: false },
		})

		await new Promise<void>((resolve, reject) => {
			conn.connect((err) => {
				if (err) return reject(err)
				conn.quit((err) => {
					if (err) reject(err)
					else {
						expect(conn.state()).toBe(SMTPState.NOTCONNECTED)
						resolve()
					}
				})
			})
		})
	})

	it('fails to connect to invalid port', async () => {
		const conn = new SMTPConnection({
			port: 12345,
			host: '127.0.0.1',
			timeout: 100,
		})

		await new Promise<void>((resolve, reject) => {
			conn.connect((err) => {
				if (err) {
					expect(err.message).toBeDefined()
					resolve()
				} else {
					reject(new Error('Should have failed to connect'))
				}
			})
		})
	})

	it('fails login with unsupported auth method', async () => {
		const conn = new SMTPConnection({
			port: PORT,
			host: '127.0.0.1',
			tls: { rejectUnauthorized: false },
			authentication: ['CRAM-MD5'], // Server does not support this
		})

		await new Promise<void>((resolve, reject) => {
			conn.connect((err) => {
				if (err) return reject(err)
				conn.login(
					(err) => {
						if (err) {
							expect(err.message).toContain('no form of authorization supported')
							resolve()
						} else {
							reject(new Error('Should have failed'))
						}
					},
					'user',
					'pass'
				)
			})
		})
		conn.close()
	})

	it('fails login with unknown auth method', async () => {
		const conn = new SMTPConnection({
			port: PORT,
			host: '127.0.0.1',
			tls: { rejectUnauthorized: false },
			// @ts-expect-error testing invalid input
			authentication: ['XYZ'], // Completely unknown method
		})

		await new Promise<void>((resolve, reject) => {
			conn.connect((err) => {
				if (err) return reject(err)
				conn.login(
					(err) => {
						if (err) {
							expect(err.message).toContain('no form of authorization supported')
							resolve()
						} else {
							reject(new Error('Should have failed'))
						}
					},
					'user',
					'pass'
				)
			})
		})
		conn.close()
	})
})
