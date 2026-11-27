import { readFileSync } from 'fs'
import type { AddressInfo } from 'net'
import {
	describe,
	it,
	expect,
	beforeAll,
	afterAll,
	afterEach,
	vi,
} from 'vitest'
import { SMTPServer } from 'smtp-server'
import {
	SMTPConnection,
	SMTPState,
	type SMTPSocketOptions,
} from './connection.js'
import { SMTPError, SMTPErrorStates } from './error.js'

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
					callback(new Error(`Rejected test credentials: ${auth.password}`))
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

	it('reports rejected AUTH LOGIN without including the password in either error', async () => {
		const conn = new SMTPConnection({
			authentication: ['LOGIN'],
			port: PORT,
			host: '127.0.0.1',
			tls: { rejectUnauthorized: false },
		})

		try {
			await new Promise<void>((resolve, reject) =>
				conn.connect((err) => (err ? reject(err) : resolve()))
			)
			const password = 'wrong-password'
			const err = await new Promise<Error | null | undefined>((resolve) =>
				conn.login(resolve, 'user', password)
			)
			expect(err).toMatchObject({
				code: SMTPErrorStates.AUTHFAILED,
				previous: { code: SMTPErrorStates.BADRESPONSE },
			})
			const previous = (err as SMTPError).previous
			for (const detail of [
				String(err),
				String(previous),
				JSON.stringify(err),
			]) {
				expect(detail).not.toContain('Rejected test credentials')
				expect(detail).not.toContain(password)
				expect(detail).not.toContain(Buffer.from(password).toString('base64'))
			}
		} finally {
			conn.close(true)
		}
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
							expect(err.message).toContain(
								'no form of authorization supported'
							)
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
							expect(err.message).toContain(
								'no form of authorization supported'
							)
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

describe('STARTTLS relay verification', () => {
	const certificate = readFileSync(
		new URL('../test/fixtures/starttls/localhost-cert.pem', import.meta.url)
	)
	const privateKey = readFileSync(
		new URL('../test/fixtures/starttls/localhost-key.pem', import.meta.url)
	)
	const onAuthAttempt = vi.fn()
	const relay = new SMTPServer({
		cert: certificate,
		key: privateKey,
		authMethods: ['PLAIN'],
		allowInsecureAuth: true, // Count AUTH attempts even if the client skips TLS.
		onAuth(_auth, session, callback) {
			onAuthAttempt(session.secure)
			callback(null, { user: 'test-user' })
		},
	})
	let address: AddressInfo
	let activeConnection: SMTPConnection | undefined

	beforeAll(async () => {
		await new Promise<void>((resolve, reject) => {
			relay.once('error', reject)
			const listener = relay.listen(0, 'localhost', () => {
				relay.off('error', reject)
				address = listener.address() as AddressInfo
				resolve()
			})
		})
	})

	afterAll(async () => {
		await new Promise<void>((resolve) => relay.close(resolve))
	})

	afterEach(() => {
		activeConnection?.close(true)
		activeConnection = undefined
		onAuthAttempt.mockClear()
	})

	async function login(tls: true | SMTPSocketOptions, host = 'localhost') {
		const connection = new SMTPConnection({
			host,
			port: address.port,
			tls,
			user: 'test-user',
			password: 'test-password',
		})
		activeConnection = connection
		await new Promise<void>((resolve, reject) => {
			connection.connect((err) => (err ? reject(err) : resolve()))
		})
		await new Promise<void>((resolve, reject) => {
			connection.login((err) => (err ? reject(err) : resolve()))
		})
		return connection
	}

	it('rejects an untrusted certificate before AUTH', async () => {
		await expect(login(true)).rejects.toMatchObject({
			code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
		})
		expect(onAuthAttempt).not.toHaveBeenCalled()
	})

	it('rejects a trusted certificate for the wrong host before AUTH', async () => {
		// The certificate identifies localhost, not its numeric loopback address.
		await expect(
			login({ ca: certificate }, address.address)
		).rejects.toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' })
		expect(onAuthAttempt).not.toHaveBeenCalled()
	})

	it('allows AUTH over TLS with a trusted certificate for the relay host', async () => {
		await login({ ca: certificate })
		expect(onAuthAttempt).toHaveBeenCalledExactlyOnceWith(true)
	})

	it('fails the next command if the relay disconnects while TLS is idle', async () => {
		const connection = await login({ ca: certificate })
		const disconnected = new Promise<void>((resolve) =>
			connection.once('close', resolve)
		)
		for (const relayConnection of relay.connections) relayConnection.close()
		await disconnected

		const command = new Promise<void>((resolve, reject) => {
			connection.command('noop', (err) => (err ? reject(err) : resolve()))
		})
		await expect(command).rejects.toMatchObject({
			code: SMTPErrorStates.NOCONNECTION,
		})
	})
})
