import { Socket } from 'node:net'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SMTPConnection, SMTPState } from './connection.js'
import { SMTPErrorStates } from './error.js'

class TestConnection extends SMTPConnection {
	attach(socket: Socket) {
		this.sock = socket
		this._state = SMTPState.CONNECTED
	}
}

function scriptedPeer() {
	const socket = new Socket()
	const write = vi.spyOn(socket, 'write').mockReturnValue(true)
	onTestFinished(() => {
		socket.destroy()
	})
	function reply(code: string, message: string, data = `${code} ${message}`) {
		socket.emit('response', null, { code, message, data })
	}
	return { socket, write, reply }
}

function setup() {
	const original = scriptedPeer()
	const replacement = scriptedPeer()
	const conn = new TestConnection({
		domain: 'client.test',
		user: 'sender',
		password: 'secret',
		authentication: ['LOGIN', 'PLAIN'],
	})
	conn.attach(original.socket)
	return { original, replacement, conn }
}

const ehlo = 'ehlo client.test\r\n'

function authenticate(
	conn: TestConnection,
	peer: ReturnType<typeof scriptedPeer>
) {
	const done = vi.fn()
	conn.login(done)
	expect(peer.write.mock.calls).toEqual([[ehlo]])
	peer.reply('250', 'AUTH PLAIN')
	expect(peer.write.mock.calls).toEqual([
		[ehlo],
		[expect.stringMatching(/^AUTH PLAIN \S+\r\n$/)],
	])
	expect(done).not.toHaveBeenCalled()
	peer.reply('235', 'authenticated')
	expect(done.mock.calls).toHaveLength(1)
	expect(done.mock.calls[0][0]).toBeNull()
	expect(conn.authorized()).toBe(true)
}

it.each(['ehlo', 'helo'] as const)(
	'rejects a late %s reply without changing replacement capabilities',
	(verb) => {
		const { original, replacement, conn } = setup()
		const stale = vi.fn()
		conn[verb](stale)
		expect(original.write.mock.calls).toEqual([[`${verb} client.test\r\n`]])
		conn.attach(replacement.socket)
		authenticate(conn, replacement)

		// The replacement already has its own feature map when the old reply arrives.
		original.reply('250', 'OLD-ONLY')
		expect(stale).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ code: SMTPErrorStates.CONNECTIONCLOSED })
		)
		expect(conn.has_extn('OLD-ONLY')).toBe(false)
		expect(conn.has_extn('AUTH')).toBe(true)
	}
)

it('does not reuse an explicit EHLO after direct socket replacement', () => {
	const { original, replacement, conn } = setup()
	const done = vi.fn()
	conn.ehlo(done)
	expect(original.write.mock.calls).toEqual([[ehlo]])
	const data = '250-OLD-ONLY\n250 AUTH LOGIN'
	original.reply('250', 'AUTH LOGIN', data)
	expect(done).toHaveBeenCalledExactlyOnceWith(null, data)
	expect(conn.has_extn('OLD-ONLY')).toBe(true)

	conn.attach(replacement.socket) // No close() to clear the feature cache.
	expect(conn.has_extn('OLD-ONLY')).toBe(false)
	authenticate(conn, replacement)
})
