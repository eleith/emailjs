import { Socket } from 'node:net'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SMTPConnection, SMTPState } from './connection.js'
import { SMTPErrorStates } from './error.js'

// Use real SMTP dispatch. Only the socket writes and relay
// replies are scripted, so every assertion has a precise place in wire order.
class TestConnection extends SMTPConnection {
	// Subclasses may redeclare this field as well as assign it.
	protected override sock: Socket | null = null

	override command(
		...[cmd, done, codes]: Parameters<SMTPConnection['command']>
	) {
		super.command(cmd, (...args) => done(...args), codes)
	}

	override send(line: string, done: Parameters<SMTPConnection['send']>[1]) {
		super.send(line, (...args) => done(...args))
	}

	attach(socket: Socket) {
		this.sock = socket
		this._state = SMTPState.CONNECTED
	}
}

function createScriptedPeer() {
	const socket = new Socket()
	const write = vi.spyOn(socket, 'write').mockReturnValue(true)
	onTestFinished(() => {
		socket.destroy()
	})
	const reply = (code: string, message: string) =>
		socket.emit('response', null, {
			code,
			message,
			data: `${code} ${message}`,
		})
	return { socket, write, reply }
}

it('allows JavaScript callers to omit the callback to public send()', () => {
	const peer = createScriptedPeer()
	const conn = new TestConnection()
	conn.attach(peer.socket)
	// Exercise the base implementation, not the fixture's callback-wrapping override.
	// @ts-expect-error The TypeScript API requires a callback; JavaScript callers can omit it.
	SMTPConnection.prototype.send.call(conn, 'NOOP\r\n')
	expect(peer.write.mock.calls).toEqual([['NOOP\r\n']])
	expect(() => peer.reply('250', 'OK')).not.toThrow()
})

function startLoginAwaitingEhloReply(
	logger: (entry: unknown) => void,
	method: 'LOGIN' | 'PLAIN' | 'CRAM-MD5' = 'LOGIN'
) {
	const original = createScriptedPeer()
	const conn = new TestConnection({
		logger,
		domain: 'client.test',
		user: 'sender',
		password: 'secret',
		authentication: [method],
	})
	conn.attach(original.socket)
	const loginDone = vi.fn()
	conn.login(loginDone)
	expect(original.write.mock.calls).toEqual([['ehlo client.test\r\n']])
	original.write.mockClear()
	return { original, conn, loginDone }
}

it.each([
	{
		method: 'CRAM-MD5',
		steps: [
			// Preserve the existing two spaces after AUTH on the wire.
			['250', 'AUTH CRAM-MD5', 'AUTH  CRAM-MD5\r\n'],
			// Fixed challenge <1234@relay.test> and response for sender / secret.
			[
				'334',
				'PDEyMzRAcmVsYXkudGVzdD4=',
				'c2VuZGVyIGQ2MzRkMmExZDk0NGE1YWM0NTdhMGYyNjIzMjA0NGU4\r\n',
			],
		],
	},
	{
		method: 'LOGIN',
		steps: [
			['250', 'AUTH LOGIN', 'AUTH LOGIN\r\n'],
			['334', 'VXNlcm5hbWU6', 'c2VuZGVy\r\n'],
			['334', 'UGFzc3dvcmQ6', 'c2VjcmV0\r\n'],
		],
	},
] as const)(
	'preserves the $method challenge transcript and final reply',
	({ method, steps }) => {
		const { original, conn, loginDone } = startLoginAwaitingEhloReply(
			() => {},
			method
		)
		for (const [code, message, line] of steps) {
			original.reply(code, message)
			expect(original.write.mock.calls).toEqual([[line]])
			original.write.mockClear()
			expect(loginDone).not.toHaveBeenCalled()
			expect(conn.authorized()).toBe(false)
		}
		original.reply('235', 'authenticated')
		expect(original.write).not.toHaveBeenCalled()
		expect(loginDone).toHaveBeenCalledExactlyOnceWith(
			null,
			'235 authenticated',
			'authenticated'
		)
		expect(conn.authorized()).toBe(true)
	}
)

it.each(['MAIL', 'NOOP'] as const)(
	'lets nested %s own its reply instead of writing the first AUTH',
	(verb) => {
		vi.useFakeTimers()
		onTestFinished(() => {
			vi.useRealTimers()
		})
		const nestedDone = vi.fn()
		const { original, conn, loginDone } = startLoginAwaitingEhloReply(
			(entry) => {
				if (entry !== 'AUTH LOGIN\r\n') return
				if (verb === 'MAIL') conn.mail(nestedDone, '<sender@example.test>')
				else conn.command('NOOP', nestedDone)
			}
		)
		const send = vi.spyOn(conn, 'send') // Forward to the public implementation.
		const observer = vi.fn()
		original.socket.on('response', observer)
		original.reply('250', 'AUTH LOGIN')

		const line =
			verb === 'MAIL' ? 'mail FROM:<sender@example.test>\r\n' : 'NOOP\r\n'
		expect(send).toHaveBeenCalledWith(line, expect.any(Function))
		expect(original.write.mock.calls).toEqual([[line]])
		expect(loginDone).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
		expect(nestedDone).not.toHaveBeenCalled()
		expect(original.socket.listenerCount('response')).toBe(2) // observer + nested command
		observer.mockClear()
		if (verb === 'MAIL') {
			original.reply('550', 'sender refused')
			expect(nestedDone).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({
					message: expect.stringContaining('sender refused'),
				})
			)
		} else {
			original.reply('250', 'OK')
			expect(nestedDone).toHaveBeenCalledExactlyOnceWith(null, '250 OK', 'OK')
		}
		vi.runAllTimers()
		expect(observer).toHaveBeenCalledTimes(1)
		expect(conn.state()).toBe(SMTPState.CONNECTED)
		expect(conn.authorized()).toBe(false)
		expect(original.socket.writableEnded).toBe(false)
		expect(original.write.mock.calls).toEqual([[line]])
		expect(loginDone).toHaveBeenCalledTimes(1)
	}
)

it('does not start AUTH over a NOOP issued while logging the EHLO reply', () => {
	const done = vi.fn()
	const { original, conn, loginDone } = startLoginAwaitingEhloReply((entry) => {
		if (
			typeof entry === 'object' &&
			entry &&
			'message' in entry &&
			entry.message === 'AUTH LOGIN'
		)
			conn.command('NOOP', done)
	})
	original.reply('250', 'AUTH LOGIN')
	expect(original.write.mock.calls).toEqual([['NOOP\r\n']])
	expect(loginDone).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
	original.reply('250', 'OK')
	expect(done).toHaveBeenCalledExactlyOnceWith(null, '250 OK', 'OK')
})

it('does not start AUTH after a DATA write from the logger', () => {
	const { original, conn, loginDone } = startLoginAwaitingEhloReply((entry) => {
		if (entry === 'AUTH LOGIN\r\n') conn.message('marker')
	})
	original.reply('250', 'AUTH LOGIN')
	expect(original.write.mock.calls).toEqual([['marker']])
	expect(loginDone).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
})

it('keeps a final DATA acknowledgment when the reply logger closes the socket', () => {
	const original = createScriptedPeer()
	const conn = new TestConnection({
		logger: (entry) => {
			if (typeof entry === 'object') conn.close(true)
		},
	})
	conn.attach(original.socket)
	const done = vi.fn()
	conn.data_end(done)
	original.reply('250', 'queued')
	expect(done).toHaveBeenCalledExactlyOnceWith(null, '250 queued', 'queued')
})

it.each(['250', '550'])(
	'reports CONNECTIONCLOSED if the session is replaced before its %s EHLO reply is processed',
	(code) => {
		const replacement = createScriptedPeer()
		const { original, conn, loginDone } = startLoginAwaitingEhloReply(
			(entry) => {
				if (typeof entry === 'object') {
					conn.close(true)
					conn.attach(replacement.socket)
				}
			}
		)
		original.reply(
			code,
			code === '250' ? 'relay without AUTH' : 'EHLO rejected'
		)
		expect(loginDone).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ code: SMTPErrorStates.CONNECTIONCLOSED })
		)
		expect(replacement.write).not.toHaveBeenCalled()
		expect(conn.state()).toBe(SMTPState.CONNECTED)
	}
)

it('reports a socket retired by the send logger without leaving a reply listener', () => {
	const original = createScriptedPeer()
	const conn = new TestConnection({ logger: () => conn.close(true) })
	conn.attach(original.socket)
	const done = vi.fn()
	conn.send('NOOP\r\n', done)
	expect(original.write).not.toHaveBeenCalled()
	expect(original.socket.listenerCount('response')).toBe(0)
	expect(done).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
})

it('never writes an AUTH retry to a replacement socket', () => {
	vi.useFakeTimers()
	onTestFinished(() => {
		vi.useRealTimers()
	})
	const replacement = createScriptedPeer()
	const { original, conn, loginDone } = startLoginAwaitingEhloReply(
		() => {},
		'PLAIN'
	)
	original.reply('250', 'AUTH PLAIN')
	expect(original.write.mock.calls).toEqual([
		[expect.stringMatching(/^AUTH PLAIN /)],
	])
	original.reply('451', 'greylist; try again')
	expect(loginDone).not.toHaveBeenCalled()
	conn.close(true)
	conn.attach(replacement.socket)
	const replacementLogin = vi.fn()
	conn.login(replacementLogin)
	replacement.reply('250', 'AUTH PLAIN')
	replacement.reply('235', 'authenticated')
	expect(replacementLogin).toHaveBeenCalledTimes(1)
	expect(conn.authorized()).toBe(true)
	replacement.write.mockClear()
	vi.runAllTimers()
	expect(conn.authorized()).toBe(true)
	expect(replacement.write).not.toHaveBeenCalled()
	expect(loginDone).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
	expect(conn.state()).toBe(SMTPState.CONNECTED)
})

it('does not write a continuation if listener registration replaces the socket', () => {
	const replacement = createScriptedPeer()
	const { original, conn, loginDone } = startLoginAwaitingEhloReply(() => {})
	original.reply('250', 'AUTH LOGIN')
	original.socket.once('newListener', () => {
		// Direct field assignment does not go through close() or another send().
		conn.attach(replacement.socket)
	})
	original.reply('334', 'Username')
	expect(original.socket.listenerCount('response')).toBe(0)
	expect(original.write.mock.calls).toEqual([['AUTH LOGIN\r\n']])
	expect(replacement.write).not.toHaveBeenCalled()
	expect(loginDone).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
})

it.each(['334', '235'])(
	'does not apply an AUTH %s reply to a replacement socket',
	(code) => {
		const replacement = createScriptedPeer()
		const { original, conn, loginDone } = startLoginAwaitingEhloReply(
			(entry) => {
				if (
					typeof entry === 'object' &&
					entry !== null &&
					'code' in entry &&
					entry.code === code
				) {
					conn.close(true)
					conn.attach(replacement.socket)
				}
			},
			code === '334' ? 'LOGIN' : 'PLAIN'
		)
		original.reply('250', code === '334' ? 'AUTH LOGIN' : 'AUTH PLAIN')
		expect(original.write).toHaveBeenCalledTimes(1)
		original.reply(code, code === '334' ? 'VXNlcm5hbWU6' : 'authenticated')
		expect(replacement.write).not.toHaveBeenCalled()
		expect(loginDone).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
		expect(conn.authorized()).toBe(false)
		expect(conn.state()).toBe(SMTPState.CONNECTED)
		expect(replacement.socket.writableEnded).toBe(false)
	}
)
