import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { Socket, type AddressInfo } from 'node:net'
import { TLSSocket } from 'node:tls'
import { SMTPServer } from 'smtp-server'
import { expect, it, onTestFinished, vi } from 'vitest'
import {
	SMTPConnection,
	type SMTPConnectionOptions,
	SMTPState,
} from './connection.js'
import { SMTPErrorStates } from './error.js'

class TestConnection extends SMTPConnection {
	attach(socket: Socket) {
		const old = this.sock
		this.sock = socket
		this._state = SMTPState.CONNECTED
		return old
	}
}

const options: Partial<SMTPConnectionOptions> = {
	domain: 'client.test',
	user: 'sender',
	password: 'secret',
	authentication: ['PLAIN'],
}
const ehlo = 'ehlo client.test\r\n'
const starttls = 'starttls\r\n'

function peer(conn: TestConnection) {
	const socket = new Socket()
	const write = vi.spyOn(socket, 'write').mockReturnValue(true)
	const old = conn.attach(socket)
	onTestFinished(() => {
		socket.destroy()
		old?.destroy()
	})
	return {
		old,
		write,
		reply(code: string, message: string, data = `${code} ${message}`) {
			socket.emit('response', null, { code, message, data })
		},
	}
}

function greetedPeer(conn: TestConnection) {
	const p = peer(conn)
	const done = vi.fn()
	conn.ehlo(done)
	expect(p.write.mock.calls).toEqual([[ehlo]])
	p.reply('250', 'AUTH PLAIN')
	expect(done).toHaveBeenCalledExactlyOnceWith(null, '250 AUTH PLAIN')
	p.write.mockClear()
	return p
}

it('requires STARTTLS again on a direct socket swap after verified STARTTLS', async () => {
	const fixture = (name: string) =>
		readFileSync(new URL(`../test/fixtures/starttls/${name}`, import.meta.url))
	const cert = fixture('localhost-cert.pem')
	const relay = new SMTPServer({ cert, key: fixture('localhost-key.pem') })
	const listener = relay.listen(0, 'localhost')
	await once(listener, 'listening')
	const conn = new TestConnection({
		...options,
		host: 'localhost',
		port: (listener.address() as AddressInfo).port,
		tls: { ca: cert },
	})
	onTestFinished(async () => {
		conn.close(true)
		for (const session of relay.connections) session.close()
		await new Promise<void>((resolve) => relay.close(resolve))
	})
	await new Promise<void>((resolve, reject) =>
		conn.connect((err) => (err ? reject(err) : resolve()))
	)
	await new Promise<void>((resolve, reject) =>
		conn.ehlo((err) => (err ? reject(err) : resolve()))
	)
	const replacement = peer(conn)
	expect(replacement.old).toBeInstanceOf(TLSSocket)
	expect((replacement.old as TLSSocket).authorized).toBe(true)

	const done = vi.fn()
	conn.login(done)
	expect(replacement.write.mock.calls).toEqual([[ehlo]])
	replacement.reply('250', 'AUTH PLAIN', '250-STARTTLS\n250 AUTH PLAIN')
	expect(replacement.write.mock.calls).toEqual([[ehlo], [starttls]])
	expect(done).not.toHaveBeenCalled()
	replacement.reply('454', 'TLS unavailable')
	expect(done).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
	expect(replacement.write.mock.calls).toEqual([[ehlo], [starttls]])
})

it('reports unauthorized on the first query after replacing an authenticated socket', () => {
	const conn = new TestConnection(options)
	const original = greetedPeer(conn)
	const done = vi.fn()
	conn.login(done)
	expect(original.write.mock.calls).toEqual([
		[expect.stringMatching(/^AUTH PLAIN \S+\r\n$/)],
	])
	original.reply('235', 'authenticated')
	expect(done).toHaveBeenCalledTimes(1)
	expect(done.mock.calls[0][0]).toBeNull()
	expect(conn.authorized()).toBe(true)
	peer(conn)
	expect(conn.authorized()).toBe(false)
})

it('reports successful raw AUTH and never starts managed login between SASL steps or after success', () => {
	const conn = new TestConnection(options)
	const relay = greetedPeer(conn)
	const challenge = vi.fn()
	conn.command('AUTH PLAIN', challenge, [334])
	relay.reply('334', 'continue')
	expect(challenge).toHaveBeenCalledTimes(1)
	expect(conn.authorized()).toBe(false)
	const refused = vi.fn()
	conn.login(refused)
	const response = vi.fn()
	const answer = Buffer.from('\0sender\0secret').toString('base64') + '\r\n'
	conn.send(answer, response)
	relay.reply('235', 'authenticated')
	expect(response).toHaveBeenCalledTimes(1)
	expect(conn.authorized()).toBe(true)
	conn.login(refused)
	expect(refused.mock.calls).toEqual([[expect.any(Error)], [expect.any(Error)]])
	expect(relay.write.mock.calls).toEqual([['AUTH PLAIN\r\n'], [answer]])
})

it('refuses managed login after the first 550 to an ambiguous multiline send', () => {
	const conn = new TestConnection(options)
	const p = greetedPeer(conn)
	const raw = vi.fn()
	const lines = 'NOOP\r\nMAIL FROM:<sender@example.test>\r\n'
	conn.send(lines, raw)
	p.reply('550', 'rejected')
	expect(raw).toHaveBeenCalledTimes(1)
	expect(raw.mock.calls[0][1]).toMatchObject({ code: '550' })
	const login = vi.fn()
	conn.login(login)
	expect(login).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
	expect(p.write.mock.calls).toEqual([[lines]])
})

it.each([false, true])(
	'rejects the public greeting helper during manual STARTTLS (cached greeting: %s)',
	(cached) => {
		const conn = new TestConnection(options)
		const p = cached ? greetedPeer(conn) : peer(conn)
		const upgrade = vi.fn()
		conn.starttls(upgrade)
		const greeting = vi.fn()
		conn.ehlo_or_helo_if_needed(greeting)
		expect(greeting).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
		expect(upgrade).not.toHaveBeenCalled()
		expect(p.write.mock.calls).toEqual([[starttls]])
		p.reply('454', 'TLS unavailable')
		expect(upgrade).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				code: SMTPErrorStates.BADRESPONSE,
				smtp: '454 TLS unavailable',
			})
		)
		expect(greeting).toHaveBeenCalledTimes(1)
		expect(p.write.mock.calls).toEqual([[starttls]])
	}
)
