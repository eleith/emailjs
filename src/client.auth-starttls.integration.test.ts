import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { SMTPServer } from 'smtp-server'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SMTPClient, SMTPErrorStates } from './index.js'

it('waits for manual STARTTLS to finish before recovering interrupted managed AUTH', async () => {
	const sessions: string[] = []
	const authSessions: string[] = []
	const deliveries: string[] = []
	const relay = new SMTPServer({
		key: readFileSync(
			new URL('../test/fixtures/starttls/localhost-key.pem', import.meta.url)
		),
		cert: readFileSync(
			new URL('../test/fixtures/starttls/localhost-cert.pem', import.meta.url)
		),
		allowInsecureAuth: true,
		authMethods: ['PLAIN'],
		onConnect(session, done) {
			sessions.push(session.id)
			done()
		},
		onAuth(_auth, session, done) {
			authSessions.push(session.id)
			done(null, { user: 'user' })
		},
		onData(stream, _session, done) {
			let body = ''
			stream.on('data', (chunk) => {
				body += chunk
			})
			stream.on('end', () => {
				deliveries.push(body)
				done()
			})
		},
	})
	const listener = relay.listen(0, '127.0.0.1')
	let firstPlaintext = ''
	// Capture even pipelined bytes the relay's SMTP parser might discard on upgrade.
	listener.once('connection', (socket) => {
		socket.on('data', (chunk) => {
			firstPlaintext += chunk.toString('latin1')
		})
	})
	await once(listener, 'listening')
	const events: string[] = []
	const handshake = vi.fn((_err: Error | null | undefined) => {
		events.push('STARTTLS callback')
	})
	let inject = true
	const client = new SMTPClient({
		domain: 'client.test',
		host: '127.0.0.1',
		port: (listener.address() as AddressInfo).port,
		user: 'user',
		password: 'secret',
		logger(entry) {
			if (typeof entry !== 'string') return
			if (entry.startsWith('connecting:')) events.push('connect')
			if (inject && entry.startsWith('AUTH PLAIN ')) {
				inject = false
				client.smtp.starttls(handshake)
			}
		},
	})
	onTestFinished(async () => {
		client.smtp.close(true)
		await new Promise<void>((resolve) => relay.close(resolve))
	})
	const message = {
		from: 'a@example.test',
		to: 'b@example.test',
		subject: 'test',
		text: 'first body',
	}
	const first = vi.fn((_err: Error | null) => {
		events.push('first callback')
	})
	client.send(message, first)
	await client.sendAsync({ ...message, text: 'second body' })

	expect(first).toHaveBeenCalledExactlyOnceWith(
		expect.objectContaining({ code: SMTPErrorStates.AUTHFAILED }),
		expect.anything()
	)
	// A close on the plaintext 220 could also cause a handshake error. Only
	// certificate verification proves TLS actually got to the peer certificate.
	expect(handshake).toHaveBeenCalledExactlyOnceWith(
		expect.objectContaining({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })
	)
	expect(events).toEqual([
		'connect',
		'first callback',
		'STARTTLS callback',
		'connect',
	])
	expect(firstPlaintext.toUpperCase()).toBe('EHLO CLIENT.TEST\r\nSTARTTLS\r\n')
	expect(sessions).toHaveLength(2)
	expect(authSessions).toEqual([sessions[1]])
	expect(deliveries).toEqual([expect.stringContaining('second body')])
})
