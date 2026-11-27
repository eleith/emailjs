import { describe, it, expect, vi } from 'vitest'
import { Readable } from 'stream'
import { SMTPClient, type MessageStack } from './client.js'
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

	describe('recipient groups', () => {
		it.each(['to', 'cc', 'bcc'] as const)(
			'uses the members of %s groups as envelope recipients',
			(field) => {
				const client = new SMTPClient({ host: '127.0.0.1' })
				const msg = new Message({
					from: 'sender@origin.test',
					[field]:
						'Dispatch: Mira <mira@delivery.test>, Otis <otis@delivery.test>;',
				})
				const stack = client.createMessageStack(msg)
				expect(stack.to.map(({ address }) => address)).toEqual([
					'mira@delivery.test',
					'otis@delivery.test',
				])
				expect(stack.from).toBe('sender@origin.test')
			}
		)

		it.each(['to', 'cc', 'bcc'] as const)(
			'flattens groups in %s arrays assigned after construction',
			(field) => {
				const client = new SMTPClient({ host: '127.0.0.1' })
				const msg = new Message({
					from: 'sender@origin.test',
					[field]: 'initial@delivery.test',
				})
				msg.header[field] = [
					'first@delivery.test',
					'Dispatch: mira@delivery.test, otis@delivery.test;',
					'Private:;',
					'last@delivery.test',
				]
				expect(
					client.createMessageStack(msg).to.map(({ address }) => address)
				).toEqual([
					'first@delivery.test',
					'mira@delivery.test',
					'otis@delivery.test',
					'last@delivery.test',
				])
			}
		)

		it('preserves case-sensitive cross-header deduplication and duplicates within each header', () => {
			const client = new SMTPClient({ host: '127.0.0.1' })
			const msg = new Message({
				from: 'sender@origin.test',
				to: 'Dispatch: mira@delivery.test, mira@delivery.test, Mira@delivery.test;',
				cc: 'Review: mira@delivery.test, otis@delivery.test, otis@delivery.test;',
				bcc: 'Archive: otis@delivery.test, archive@delivery.test;',
			})
			expect(
				client.createMessageStack(msg).to.map(({ address }) => address)
			).toEqual([
				'mira@delivery.test',
				'mira@delivery.test',
				'Mira@delivery.test',
				'otis@delivery.test',
				'otis@delivery.test',
				'archive@delivery.test',
			])
		})

		it.each(['to', 'cc', 'bcc'] as const)(
			'rejects an empty %s group before attempting a connection',
			async (field) => {
				const client = new SMTPClient({ host: '127.0.0.1' })
				const connect = vi
					.spyOn(client.smtp, 'connect')
					.mockImplementation((callback) => {
						callback(new Error('Unexpected SMTP connection'))
					})
				const msg = new Message({
					from: 'sender@origin.test',
					[field]: 'Private:;',
					text: 'Local regression fixture',
				})

				await expect(client.sendAsync(msg)).rejects.toThrow(
					'No recipients found in message'
				)
				expect(connect).not.toHaveBeenCalled()
				expect(client.queue).toEqual([])
			}
		)

		it('generates RCPT commands for BCC members with only empty visible groups', () => {
			const client = new SMTPClient({ host: '127.0.0.1' })
			const msg = new Message({
				from: 'sender@origin.test',
				to: 'Private:;',
				cc: 'Review:;',
				bcc: 'Archive: mira@delivery.test, otis@delivery.test;, archive@delivery.test',
			})
			const stack = client.createMessageStack(msg)
			const command = vi
				.spyOn(client.smtp, 'command')
				.mockImplementation((_cmd, callback) => callback(null))
			const data = vi.spyOn(client.smtp, 'data').mockImplementation(() => {})

			// @ts-expect-error accessing protected method for transport-free command capture
			client._sendrcpt(stack)

			expect(command.mock.calls.map(([cmd]) => cmd)).toEqual([
				'RCPT TO:<mira@delivery.test>',
				'RCPT TO:<otis@delivery.test>',
				'RCPT TO:<archive@delivery.test>',
			])
			expect(data).toHaveBeenCalledOnce()
		})
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
		client.smtp.message = () => {}
		client.smtp.close = () => {}
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

	it('keeps a retry queued when the login failure callback sends again', () => {
		const client = new SMTPClient({ user: 'user', password: 'password' })
		const error = new Error('Login failed')
		let state: 0 | 1 | 2 = SMTPState.NOTCONNECTED
		let failPendingLogin: () => void = () => {
			throw new Error('No login pending')
		}
		client.smtp.state = () => state
		client.smtp.connect = (callback) => {
			state = SMTPState.CONNECTED
			callback(null)
		}
		client.smtp.login = (callback) => {
			failPendingLogin = () => {
				state = SMTPState.NOTCONNECTED
				callback(error)
			}
		}

		const msg = new Message({ from: 'me', to: 'you', text: 'hi' })
		const onRetry = vi.fn()
		const onFirstSend = vi
			.fn()
			.mockImplementationOnce(() => client.send(msg, onRetry))
		client.send(msg, onFirstSend)
		failPendingLogin()
		failPendingLogin()

		expect(onFirstSend).toHaveBeenCalledExactlyOnceWith(error, msg)
		expect(onRetry).toHaveBeenCalledExactlyOnceWith(error, msg)
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
		// @ts-expect-error accessing protected
		const firstTimer = client.timer
		expect(firstTimer).not.toBeNull()

		const spy = vi.spyOn(global, 'clearTimeout')

		// Second send immediately
		await client.sendAsync(msg)
		// Should clear previous timer
		expect(spy).toHaveBeenCalledWith(firstTimer)

		spy.mockRestore()
	})

	it.each(['relay reply', 'explicit close', 'relay disconnect'])(
		'resumes queued mail after idle QUIT ends with %s',
		async (shutdown) => {
			class TestClient extends SMTPClient {
				protected override ready = true
				protected override _sendmail(stack: MessageStack) {
					this._senddone(null, stack)
				}
			}

			vi.useFakeTimers()
			try {
				const client = new TestClient({ host: 'localhost' })
				let state: ReturnType<SMTPClient['smtp']['state']> = SMTPState.CONNECTED
				vi.spyOn(client.smtp, 'state').mockImplementation(() => state)
				const close = client.smtp.close.bind(client.smtp)
				vi.spyOn(client.smtp, 'close').mockImplementation(() => {
					state = SMTPState.NOTCONNECTED
					close()
				})
				const connect = vi
					.spyOn(client.smtp, 'connect')
					.mockImplementation((done) => {
						state = SMTPState.CONNECTED
						done(null)
					})
				vi.spyOn(client.smtp, 'ehlo_or_helo_if_needed').mockImplementation(
					(done) => done(null)
				)
				let replyToQuit: (err?: Error | null) => void = () => {
					throw new Error('No QUIT pending')
				}
				const quit = vi
					.spyOn(client.smtp, 'command')
					.mockImplementation((command, done) => {
						expect(command).toBe('quit')
						replyToQuit = done
					})
				const message = new Message({ from: 'me', to: 'you', text: 'hi' })
				await client.sendAsync(message)
				vi.advanceTimersByTime(1000)
				expect(quit).toHaveBeenCalledTimes(1)

				const onQueuedSend = vi.fn()
				const sendDuringQuit = () => client.send(message, onQueuedSend)
				if (shutdown === 'relay disconnect') {
					client.smtp.once('close', sendDuringQuit)
				} else {
					sendDuringQuit()
				}
				expect(onQueuedSend).not.toHaveBeenCalled()
				expect(connect).not.toHaveBeenCalled()

				if (shutdown === 'relay reply') {
					replyToQuit(null)
				} else {
					client.smtp.close()
					if (shutdown === 'relay disconnect') {
						expect(connect).not.toHaveBeenCalled()
						replyToQuit(new Error('Relay disconnected'))
					}
				}

				expect(connect).not.toHaveBeenCalled()
				await Promise.resolve()
				expect(connect).toHaveBeenCalledTimes(1)
				expect(onQueuedSend).toHaveBeenCalledExactlyOnceWith(null, message)
			} finally {
				vi.useRealTimers()
			}
		}
	)

	it('client clears poll timer when connection is closed', async () => {
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

		const msg = new Message({
			from: 'me@example.com',
			to: 'you@example.com',
			text: 'hi',
		})

		await client.sendAsync(msg)
		// Now queue is empty, and client.timer should be set:
		// @ts-expect-error accessing protected
		expect(client.timer).not.toBeNull()

		// When connection is closed manually, the timer should be cleared
		client.smtp.close()

		// @ts-expect-error accessing protected
		expect(client.timer).toBeNull()
	})
})
