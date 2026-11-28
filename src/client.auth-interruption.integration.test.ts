import { createServer, type AddressInfo } from 'node:net'
import { once } from 'node:events'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SMTPClient } from './client.js'

// Hold the first NOOP reply. Subsequent connections accept ordinary PLAIN delivery.
async function openRelay() {
	const sessions: string[][] = []
	const bodies: string[] = []
	const events: string[] = []
	type HeldReply = {
		reply(): void
		greylist(): void
		disconnect(): void
		disconnectDuringBackoff(): void
	}
	let recordNoop!: (held: HeldReply) => void
	const noopReceived = new Promise<HeldReply>((resolve) => {
		recordNoop = resolve
	})
	const relay = createServer((socket) => {
		const commands: string[] = []
		sessions.push(commands)
		events.push('relay connection')
		socket.write('220 local\r\n')
		let pending = '',
			body: string | undefined
		socket.on('data', (chunk) => {
			const lines = (pending + chunk.toString()).split('\r\n')
			pending = lines.pop()!
			for (const line of lines) {
				if (body !== undefined) {
					if (line !== '.') {
						body += line + '\n'
						continue
					}
					bodies.push(body)
					body = undefined
					socket.write('250 accepted\r\n')
					continue
				}
				const verb = line.split(' ')[0].toUpperCase()
				commands.push(verb)
				switch (verb) {
					case 'EHLO':
						socket.write('250-local\r\n250 AUTH PLAIN\r\n')
						break
					case 'NOOP':
						if (commands.filter((c) => c === 'NOOP').length > 1) {
							socket.write('250 noop complete\r\n')
							break
						}
						recordNoop({
							disconnectDuringBackoff: () =>
								socket.end('451 greylist; try again\r\n'),
							greylist: () => socket.write('451 greylist; try again\r\n'),
							reply: () => socket.write('250 noop complete\r\n'),
							disconnect: () => socket.destroy(),
						})
						break
					case 'AUTH':
						socket.write('235 ok\r\n')
						break
					case 'DATA':
						body = ''
						socket.write('354 go ahead\r\n')
						break
					case 'QUIT':
						socket.end('221 bye\r\n')
						break
					default:
						socket.write('250 ok\r\n')
				}
			}
		})
	})
	relay.listen(0, '127.0.0.1')
	await once(relay, 'listening')
	const onNoop = vi.fn((_err: unknown) => {
		events.push('NOOP complete')
	})
	let inject = true
	const client = new SMTPClient({
		host: '127.0.0.1',
		port: (relay.address() as AddressInfo).port,
		user: 'user',
		password: 'secret',
		logger(entry) {
			if (
				inject &&
				typeof entry === 'string' &&
				entry.startsWith('AUTH PLAIN ')
			) {
				inject = false
				client.smtp.command('NOOP', onNoop)
			}
		},
	})
	onTestFinished(async () => {
		client.smtp.close(true)
		await new Promise<void>((resolve) => relay.close(() => resolve()))
	})
	return { client, noopReceived, onNoop, sessions, bodies, events }
}

const first = {
	from: 'a@example.test',
	to: 'b@example.test',
	subject: 'first',
	text: 'first body',
}

it.each([
	'reply',
	'greylist',
	'disconnect',
	'disconnectDuringBackoff',
] as const)(
	'delivers callback-enqueued mail after the held NOOP ends with %s',
	async (outcome) => {
		const { client, noopReceived, onNoop, sessions, bodies, events } =
			await openRelay()
		const failed = vi.fn()
		const delivered = vi.fn()
		const retried = new Promise<void>((resolve, reject) =>
			client.send(first, (err) => {
				failed(err)
				client.send(
					{ ...first, subject: 'second', text: 'second body' },
					(err) => {
						delivered(err)
						if (err) reject(err)
						else resolve()
					}
				)
			})
		)
		const held = await noopReceived
		expect(sessions).toEqual([['EHLO', 'NOOP']])
		expect(failed).toHaveBeenCalledTimes(1)
		held[outcome]()
		await retried
		expect(failed).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
		expect(onNoop).toHaveBeenCalledTimes(1)
		expect(events).toEqual([
			'relay connection',
			'NOOP complete',
			'relay connection',
		])
		if (outcome === 'reply' || outcome === 'greylist')
			expect(onNoop.mock.calls[0][0]).toBeNull()
		else expect(onNoop.mock.calls[0][0]).toBeInstanceOf(Error)
		expect(delivered).toHaveBeenCalledExactlyOnceWith(null)
		expect(sessions).toEqual([
			outcome === 'greylist' ? ['EHLO', 'NOOP', 'NOOP'] : ['EHLO', 'NOOP'],
			['EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA'],
		])
		expect(bodies).toHaveLength(1)
		expect(bodies[0]).toContain('second body')
	}
)

it('queues a send from the disconnect hook until the greylisted NOOP caller is notified', async () => {
	const { client, noopReceived, events, bodies } = await openRelay()
	const failed = vi.fn()
	client.send(first, failed)
	const held = await noopReceived
	const delivered = new Promise<void>((resolve, reject) =>
		client.smtp.once('close', () => {
			events.push('send from close')
			client.send({ ...first, text: 'new message' }, (err) =>
				err ? reject(err) : resolve()
			)
		})
	)
	held.disconnectDuringBackoff()
	await delivered
	expect(events).toEqual([
		'relay connection',
		'send from close',
		'NOOP complete',
		'relay connection',
	])
	expect(failed).toHaveBeenCalledExactlyOnceWith(
		expect.any(Error),
		expect.objectContaining({ text: first.text })
	)
	expect(bodies).toHaveLength(1)
	expect(bodies[0]).toContain('new message')
})

it('does not issue idle QUIT over a NOOP that interrupted AUTH', async () => {
	const { client, noopReceived, onNoop, sessions } = await openRelay()
	const failed = vi.fn()
	client.send(first, failed)
	const held = await noopReceived
	await new Promise((resolve) => setTimeout(resolve, 1100))
	expect(sessions).toEqual([['EHLO', 'NOOP']])
	expect(onNoop).not.toHaveBeenCalled()
	held.reply()
	await vi.waitFor(() => {
		expect(onNoop).toHaveBeenCalledExactlyOnceWith(
			null,
			expect.stringContaining('250 noop complete'),
			'noop complete'
		)
		expect(failed).toHaveBeenCalledTimes(1)
	})
})
