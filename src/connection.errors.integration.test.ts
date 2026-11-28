import { describe, it, expect, afterEach, vi } from 'vitest'
import { createServer, Server, Socket } from 'net'
import { SMTPConnection, SMTPState } from './connection.js'
import { SMTPErrorStates } from './error.js'

describe('SMTPConnection (Error Handling)', () => {
	let server: Server
	let port: number

	afterEach(() => {
		if (server) {
			server.close()
		}
	})

	const startServer = (handler: (socket: Socket) => void) => {
		return new Promise<void>((resolve) => {
			server = createServer(handler)
			server.listen(0, '127.0.0.1', () => {
				// @ts-expect-error accessing address
				port = server.address().port
				resolve()
			})
		})
	}

	it('handles connection timeout', async () => {
		// Server that accepts connection but sends nothing
		await startServer(() => {})

		const conn = new SMTPConnection({
			port,
			host: '127.0.0.1',
			timeout: 500, // Short timeout
		})

		await new Promise<void>((resolve, reject) => {
			conn.connect((err) => {
				if (err) {
					expect(err.message).toContain('timedout')
					resolve()
				} else {
					reject(new Error('Should have timed out'))
				}
			})
		})
		conn.close()
	})

	it('handles bad greeting response', async () => {
		// Server that sends 500 instead of 220
		await startServer((socket) => {
			socket.write('500 Go Away\r\n')
		})

		const conn = new SMTPConnection({
			port,
			host: '127.0.0.1',
		})

		await new Promise<void>((resolve, reject) => {
			conn.connect((err) => {
				if (err) {
					expect(err.message).toContain('bad response')
					resolve()
				} else {
					reject(new Error('Should have failed with bad response'))
				}
			})
		})
		conn.close()
	})

	it('handles garbage greeting response', async () => {
		// Server that sends garbage
		await startServer((socket) => {
			socket.write('GARBAGE\r\n')
		})

		const conn = new SMTPConnection({
			port,
			host: '127.0.0.1',
			timeout: 500, // Short timeout
		})

		await new Promise<void>((resolve, reject) => {
			conn.connect((err) => {
				if (err) {
					expect(err.message).toContain('timedout')
					resolve()
				} else {
					reject(new Error('Should have failed with timeout'))
				}
			})
		})
		conn.close()
	})

	it('handles error in HELO', async () => {
		await startServer((socket) => {
			socket.write('220 welcome\r\n')
			socket.on('data', () => {
				socket.write('500 error\r\n')
			})
		})

		const conn = new SMTPConnection({ port, host: '127.0.0.1', timeout: 1000 })
		await new Promise<void>((resolve, reject) => {
			conn.connect((err) => {
				if (err) return reject(err)
				conn.helo((err) => {
					if (err) {
						expect(err.message).toContain('bad response')
						resolve()
					} else reject(new Error('Should have failed'))
				})
			})
		})
		conn.close()
	})

	it('handles error in MAIL', async () => {
		await startServer((socket) => {
			let commandCount = 0
			socket.write('220 welcome\r\n')
			socket.on('data', () => {
				commandCount++
				if (commandCount === 1) {
					socket.write('250 OK\r\n')
				} else if (commandCount === 2) {
					socket.write('500 error\r\n')
				}
			})
		})

		const conn = new SMTPConnection({ port, host: '127.0.0.1', timeout: 1000 })
		await new Promise<void>((resolve, reject) => {
			conn.connect((err) => {
				if (err) return reject(err)
				conn.helo((err) => {
					if (err) return reject(err)
					conn.mail((err) => {
						if (err) {
							expect(err.message).toContain('bad response')
							resolve()
						} else reject(new Error('Should have failed'))
					}, 'me')
				})
			})
		})
		conn.close()
	})

	it('refuses login locally while the STARTTLS handshake waits for its own timeout', async () => {
		let receivedClientHello!: () => void
		const handshakeStarted = new Promise<void>((resolve) => {
			receivedClientHello = resolve
		})
		await startServer((socket) => {
			socket.write('220 welcome\r\n')
			socket.once('data', () => {
				socket.write('220 Go ahead\r\n')
				socket.once('data', receivedClientHello)
			})
		})

		const conn = new SMTPConnection({ port, host: '127.0.0.1', timeout: 500 })
		try {
			await new Promise<void>((resolve, reject) => {
				conn.connect((err) => (err ? reject(err) : resolve()))
			})
			const upgrade = new Promise<Error | null | undefined>((resolve) => {
				conn.starttls(resolve)
			})
			await handshakeStarted
			const login = vi.fn()
			conn.login(login, 'sender', 'secret')
			expect(login).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({ code: SMTPErrorStates.AUTHFAILED })
			)
			expect(await upgrade).toMatchObject({
				code: SMTPErrorStates.TIMEDOUT,
				message: expect.stringContaining('STARTTLS handshake'),
			})
			expect(login).toHaveBeenCalledTimes(1)
			expect(conn.state()).toBe(SMTPState.NOTCONNECTED)
		} finally {
			conn.close(true)
		}
	})

	it.each(['ehlo', 'starttls'])(
		'closes without falling back to HELO when %s is refused',
		async (refusedCommand) => {
			const commands: string[] = []
			await startServer((socket) => {
				socket.write('220 welcome\r\n')
				let pending = ''
				socket.on('data', (data) => {
					const lines = (pending + data.toString()).split('\r\n')
					pending = lines.pop() ?? ''
					for (const line of lines) {
						const command = line.split(' ')[0]
						commands.push(command)
						if (command === refusedCommand)
							socket.write(`454 ${command} refused\r\n`)
						else if (command === 'ehlo')
							socket.write('250-localhost\r\n250 STARTTLS\r\n')
						else socket.write('250 hello\r\n')
					}
				})
			})

			const conn = new SMTPConnection({ port, host: '127.0.0.1', tls: true })
			try {
				await new Promise<void>((resolve, reject) => {
					conn.connect((err) => (err ? reject(err) : resolve()))
				})
				const greeting = new Promise<void>((resolve, reject) => {
					conn.ehlo_or_helo_if_needed((err) => (err ? reject(err) : resolve()))
				})
				await expect(greeting).rejects.toMatchObject({
					code: SMTPErrorStates.BADRESPONSE,
					message: expect.stringContaining(`${refusedCommand} refused`),
				})
				expect(commands).not.toContain('helo')
				expect(conn.state()).toBe(SMTPState.NOTCONNECTED)
			} finally {
				conn.close(true)
			}
		}
	)
})
