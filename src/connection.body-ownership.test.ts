import { Socket } from 'node:net'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SMTPConnection, SMTPState } from './connection.js'

class TestConnection extends SMTPConnection {
	attach(socket: Socket) {
		this.sock = socket
		this._state = SMTPState.CONNECTED
	}
}

function peer() {
	const socket = new Socket()
	onTestFinished(() => {
		socket.destroy()
	})
	return { socket, write: vi.spyOn(socket, 'write').mockReturnValue(true) }
}

it('does not start login from a message logger and leaves the bytes unchanged', () => {
	const original = peer()
	const login = vi.fn()
	const body = 'raw\r\n.\r\nbytes'
	const conn = new TestConnection({
		user: 'sender',
		password: 'secret',
		logger: (entry) => {
			if (entry === body) conn.login(login)
		},
	})
	conn.attach(original.socket)
	conn.message(body)
	expect(original.write.mock.calls).toEqual([[body]])
	expect(login).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
})

it('does not redirect message bytes to a socket attached by its logger', () => {
	const original = peer()
	const replacement = peer()
	const conn = new TestConnection({
		logger: () => conn.attach(replacement.socket),
	})
	conn.attach(original.socket)
	conn.message('old body')
	expect(original.write).not.toHaveBeenCalled()
	expect(replacement.write).not.toHaveBeenCalled()
})

it('preserves split raw dot bytes without trusting the next data_end reply', () => {
	const original = peer()
	const conn = new TestConnection({ user: 'sender', password: 'secret' })
	conn.attach(original.socket)
	conn.data(vi.fn())
	original.socket.emit('response', null, {
		code: '354',
		message: 'continue',
		data: '354 continue',
	})
	conn.message('body\r\n.')
	conn.message('\r\n')
	conn.data_end(vi.fn())
	original.socket.emit('response', null, {
		code: '250',
		message: 'queued',
		data: '250 queued',
	})
	const login = vi.fn()
	conn.login(login)
	expect(login).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
	expect(original.write.mock.calls).toEqual([
		['data\r\n'],
		['body\r\n.'],
		['\r\n'],
		['\r\n.\r\n'],
	])
})
