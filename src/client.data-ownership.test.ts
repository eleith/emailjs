import { Socket } from 'node:net'
import { Stream } from 'node:stream'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SMTPClient } from './client.js'
import { SMTPState } from './connection.js'
import { SMTPErrorStates } from './error.js'
import { Message } from './message.js'

// Only the TCP dial/write and the MIME producer are controlled. Feed wire
// replies through the real monitor so logger re-entry has its normal timing.
function startDelivery(
	replaceOn?: 'continue' | 'accepted' | 'rejected' | 'registration'
) {
	function peer(socket: Socket) {
		return {
			socket,
			write: vi.spyOn(socket, 'write').mockReturnValue(true),
			reply: (line: string) => socket.emit('data', `${line}\r\n`),
		}
	}
	const peers: ReturnType<typeof peer>[] = []
	const dial = vi
		.spyOn(Socket.prototype, 'connect')
		.mockImplementation(function (this: Socket) {
			peers.push(peer(this))
			return this
		})
	const client = new SMTPClient({
		domain: 'client.test',
		logger(entry) {
			if (
				replaceOn &&
				typeof entry === 'object' &&
				entry &&
				'message' in entry &&
				entry.message === replaceOn
			)
				replace()
		},
	})
	onTestFinished(() => {
		client.smtp.close(true)
		dial.mockRestore()
	})
	function replace() {
		client.smtp.close(true)
		client.smtp.connect(vi.fn())
		peers[1].reply('220 replacement')
	}
	const message = new Message({
		from: 'a@example.test',
		to: 'b@example.test',
		text: 'body',
	})
	const stream = new Stream()
	vi.spyOn(message, 'stream').mockReturnValue(
		stream as ReturnType<Message['stream']>
	)
	if (replaceOn === 'registration')
		client.smtp.once('newListener', (name) => {
			if (name === 'close') replace()
		})
	const done = vi.fn()
	client.send(message, done)
	const [a] = peers
	for (const line of [
		'220 original',
		'250 greeting',
		'250 sender',
		'250 recipient',
	])
		a.reply(line)
	expect(a.write.mock.calls).toEqual([
		['ehlo client.test\r\n'],
		['mail FROM:<a@example.test>\r\n'],
		['RCPT TO:<b@example.test>\r\n'],
		...(replaceOn === 'registration' ? [] : [['data\r\n']]),
	])
	if (replaceOn !== 'registration') a.reply('354 continue')
	function expectReplacementUntouched() {
		expect.soft(peers[1].write).not.toHaveBeenCalled()
		expect.soft(client.smtp.state()).toBe(SMTPState.CONNECTED)
	}
	return {
		a,
		stream,
		replace,
		expectReplacementUntouched,
		done,
		message,
		queue: client.queue,
	}
}

it('does not issue DATA if listener registration replaces the socket', () => {
	const d = startDelivery('registration')
	d.expectReplacementUntouched()
	expect(d.done).toHaveBeenCalledExactlyOnceWith(expect.any(Error), d.message)
})

it.each(['after 354', 'in the 354 logger'] as const)(
	'does not transfer a stale chunk or terminator to a session installed %s',
	(when) => {
		const d = startDelivery(when === 'after 354' ? undefined : 'continue')
		if (when === 'after 354') d.replace()
		d.stream.emit('data', 'old body')
		d.stream.emit('end')
		d.expectReplacementUntouched()
		expect(d.done).toHaveBeenCalledExactlyOnceWith(expect.any(Error), d.message)
	}
)

it('does not write the terminator after replacement between the last chunk and end', () => {
	const d = startDelivery()
	d.stream.emit('data', 'last chunk')
	expect(d.a.write).toHaveBeenLastCalledWith('last chunk')
	d.replace()
	d.stream.emit('end')
	expect(d.a.write).not.toHaveBeenCalledWith('\r\n.\r\n')
	d.expectReplacementUntouched()
	expect(d.done).toHaveBeenCalledExactlyOnceWith(expect.any(Error), d.message)
})

it('does not close the replacement when the original message stream fails', () => {
	const d = startDelivery()
	d.replace()
	const error = new Error('source failed')
	d.stream.emit('error', error)
	d.expectReplacementUntouched()
	expect(d.done).toHaveBeenCalledExactlyOnceWith(error, d.message)
	expect(d.done.mock.calls[0][0]).toBe(error)
})

it('fails once without replay when the socket closes after the dot but before acceptance', async () => {
	const d = startDelivery()
	d.stream.emit('data', 'original body')
	d.stream.emit('end')
	expect(d.a.write).toHaveBeenLastCalledWith('\r\n.\r\n')
	d.replace()
	await Promise.resolve()
	expect(d.done).toHaveBeenCalledExactlyOnceWith(expect.any(Error), d.message)
	d.stream.emit('error', new Error('late stream error'))
	d.a.reply('250 late')
	expect(d.done).toHaveBeenCalledTimes(1)
	expect(d.queue).toHaveLength(0)
	d.expectReplacementUntouched()
})

it('preserves acceptance when the final 250 logger replaces the session', () => {
	const d = startDelivery('accepted')
	d.stream.emit('data', 'original body')
	d.stream.emit('end')
	expect(d.a.write.mock.calls.slice(-2)).toEqual([
		['original body'],
		['\r\n.\r\n'],
	])
	expect(d.done).not.toHaveBeenCalled()
	d.a.reply('250 accepted')
	d.expectReplacementUntouched()
	expect(d.done).toHaveBeenCalledExactlyOnceWith(null, d.message)
})

it.each(['attached', 'replaced', 'replaced during RSET'] as const)(
	'preserves final 550 and resets only an attached original session (%s)',
	async (session) => {
		const d = startDelivery(session === 'replaced' ? 'rejected' : undefined)
		d.stream.emit('data', 'original body')
		d.stream.emit('end')
		expect(d.a.write).toHaveBeenLastCalledWith('\r\n.\r\n')
		const beforeReply = d.a.write.mock.calls.length
		d.a.reply('550 rejected')
		if (session !== 'replaced') {
			expect(d.a.write.mock.calls.slice(beforeReply)).toEqual([['rset\r\n']])
			expect(d.done).not.toHaveBeenCalled()
			if (session === 'replaced during RSET') d.replace()
			else d.a.reply('250 reset')
		} else {
			expect(d.a.write.mock.calls.slice(beforeReply)).toEqual([])
		}
		await Promise.resolve()
		if (session !== 'attached') d.expectReplacementUntouched()
		expect(d.done).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				code: SMTPErrorStates.BADRESPONSE,
				smtp: expect.stringContaining('550 rejected'),
			}),
			d.message
		)
	}
)
