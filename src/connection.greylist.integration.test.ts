import { describe, it, beforeAll, afterAll } from 'vitest'
import { SMTPServer } from 'smtp-server'
import { SMTPConnection } from './connection.js'

const PORT = 5563

describe('SMTPConnection (Greylisting)', () => {
	let server: SMTPServer
	const greylistMap = new Set<string>()

	beforeAll(async () => {
		server = new SMTPServer({
			secure: false,
			authOptional: true,
			onMailFrom(address, session, callback) {
				if (!greylistMap.has(session.id)) {
					greylistMap.add(session.id)
					const err = new Error('Greylisted, please try again')
					// @ts-expect-error adding response code
					err.responseCode = 451
					return callback(err)
				}
				callback()
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

	it('retries command on 451 greylist response', async () => {
		const conn = new SMTPConnection({ port: PORT, host: '127.0.0.1' })
		await new Promise<void>((resolve, reject) => {
			conn.connect((err) => {
				if (err) return reject(err)
				conn.helo((err) => {
					if (err) return reject(err)
					conn.mail((err) => {
						if (err) reject(err)
						else resolve()
					}, '<me@example.com>')
				})
			})
		})
		conn.close()
	})
})
