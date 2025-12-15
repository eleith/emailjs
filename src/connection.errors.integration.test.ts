import { describe, it, expect, afterEach } from 'vitest'
import { createServer, Server, Socket } from 'net'
import { SMTPConnection } from './connection.js'

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
		await startServer(() => { })

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

	    it('handles socket error during STARTTLS handshake', async () => {
	        await startServer((socket) => {
	            socket.write('220 welcome\r\n')
	            socket.on('data', (data) => {
	                const str = data.toString().toLowerCase()
	                if (str.includes('ehlo')) socket.write('250-STARTTLS\r\n250 OK\r\n')
	                else if (str.includes('starttls')) {
	                    socket.write('220 Go ahead\r\n')
	                }
	            })
	        })
	
	        const conn = new SMTPConnection({
	            port,
	            host: '127.0.0.1',
	            tls: { rejectUnauthorized: false },
	            timeout: 1000,
	        })
	        await new Promise<void>((resolve, reject) => {
	            conn.connect((err) => {
	                if (err) return reject(err)
	                conn.starttls((err) => {
	                    if (err) {
	                        expect(err.message).toBeDefined()
	                        resolve()
	                    }
	                    // Inject error after success callback
	                    setTimeout(() => {
	                        // @ts-expect-error accessing protected
	                        if (conn.sock) conn.sock.emit('error', new Error('TLS Error'))
	                    }, 10)
	                })
	            })
	        })
		conn.close()
	})
})
