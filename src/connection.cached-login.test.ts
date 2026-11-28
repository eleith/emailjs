import { Socket } from 'node:net'
import { expect, it, onTestFinished, vi } from 'vitest'
import { SMTPConnection, SMTPState } from './connection.js'

class TestConnection extends SMTPConnection {
	attach(socket: Socket) {
		this.sock = socket
		this._state = SMTPState.CONNECTED
	}
}

const ehlo = 'ehlo client.test\r\n'
const auth = `AUTH PLAIN ${Buffer.from('\0sender\0secret').toString('base64')}\r\n`
const address = '<sender@example.test>'

function scriptedSession(logger?: (entry: unknown) => void) {
	const socket = new Socket()
	const write = vi.spyOn(socket, 'write').mockReturnValue(true)
	onTestFinished(() => {
		socket.destroy()
	})
	const conn = new TestConnection({
		logger,
		domain: 'client.test',
		user: 'sender',
		password: 'secret',
		authentication: ['PLAIN'],
	})
	conn.attach(socket)
	const reply = (code: string, message: string) =>
		socket.emit('response', null, { code, message, data: `${code} ${message}` })
	// Consume the exact writes for each turn, including turns that must stay silent.
	const writes = (...lines: string[]) => {
		expect(write.mock.calls).toEqual(lines.map((line) => [line]))
		write.mockClear()
	}
	const exchange = (
		line: string,
		issue: (done: Parameters<SMTPConnection['send']>[1]) => void,
		code = '250',
		message = 'OK'
	) => {
		const done = vi.fn()
		issue(done)
		writes(line)
		expect(done).not.toHaveBeenCalled()
		reply(code, message)
		expect(done).toHaveBeenCalledTimes(1)
		expect(done.mock.calls[0][0]).toBeNull()
	}
	const greet = () =>
		exchange(ehlo, (done) => conn.ehlo(done), '250', 'AUTH PLAIN')
	const login = () => {
		const done = vi.fn()
		conn.login(done)
		return done
	}
	const loginSuccessfully = () => {
		exchange(auth, (done) => conn.login(done), '235', 'authenticated')
		expect(conn.authorized()).toBe(true)
		writes()
	}
	const refuseLogin = () => {
		const done = login()
		writes()
		expect(done).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
		return done
	}
	return {
		conn,
		reply,
		writes,
		exchange,
		greet,
		login,
		loginSuccessfully,
		refuseLogin,
	}
}

it.each([false, true])(
	'reuses explicit EHLO for login (intervening NOOP: %s)',
	(noop) => {
		const s = scriptedSession()
		s.greet()
		if (noop) s.exchange('NOOP\r\n', (done) => s.conn.command('NOOP', done))
		s.loginSuccessfully()
	}
)

it('does not let a logger start cached login while MAIL is being dispatched or its reply is being processed', () => {
	let duringMail = false
	const denied = vi.fn()
	const s = scriptedSession(() => {
		if (duringMail) s.conn.login(denied)
	})
	s.greet()
	duringMail = true
	s.exchange(`mail FROM:${address}\r\n`, (done) => s.conn.mail(done, address))
	duringMail = false
	expect(denied.mock.calls).toEqual([[expect.any(Error)], [expect.any(Error)]])
	s.exchange('rset\r\n', (done) => s.conn.rset(done))
	s.loginSuccessfully()
})

it('does not treat the first rejection of a premature DATA terminator as an idle socket', () => {
	const s = scriptedSession()
	s.greet()
	const end = vi.fn()
	s.conn.data_end(end)
	s.writes('\r\n.\r\n')
	s.reply('500', 'empty command')
	expect(end).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
	const refused = s.refuseLogin()
	s.reply('500', 'unknown command: .')
	expect(refused).toHaveBeenCalledTimes(1)
	s.writes()
})

const routes = ['command', 'send', 'helper'] as const
type Route = (typeof routes)[number]
function startEnvelope(s: ReturnType<typeof scriptedSession>, route: Route) {
	const mail = `${route === 'helper' ? 'mail' : 'MAIL'} FROM:${address}`
	s.exchange(mail + '\r\n', (done) => {
		if (route === 'helper') s.conn.mail(done, address)
		else if (route === 'command') s.conn.command(mail, done)
		else s.conn.send(mail + '\r\n', done)
	})
}

it.each(routes)(
	'refuses login after accepted MAIL via %s; accepted RSET restores login',
	(route) => {
		const s = scriptedSession()
		s.greet()
		startEnvelope(s, route)
		const refused = s.refuseLogin()
		s.exchange('rset\r\n', (done) => s.conn.rset(done))
		s.loginSuccessfully()
		expect(refused).toHaveBeenCalledTimes(1)
	}
)

it('can still login after MAIL is rejected', () => {
	const s = scriptedSession()
	s.greet()
	const mail = vi.fn()
	s.conn.mail(mail, address)
	s.writes(`mail FROM:${address}\r\n`)
	s.reply('550', 'sender rejected')
	expect(mail).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
	s.loginSuccessfully()
	expect(mail).toHaveBeenCalledTimes(1)
})

it.each(routes)(
	'refuses login in DATA via %s, even with a body line spelling RSET',
	(route) => {
		const s = scriptedSession()
		s.greet()
		startEnvelope(s, route)
		s.exchange(`RCPT TO:${address}\r\n`, (done) => s.conn.rcpt(done, address))
		s.exchange(
			route === 'helper' ? 'data\r\n' : 'DATA\r\n',
			(done) => {
				if (route === 'helper') s.conn.data(done)
				else if (route === 'command') s.conn.command('DATA', done, [354])
				else s.conn.send('DATA\r\n', done)
			},
			'354',
			'send body'
		)
		s.conn.message('RSET\r\n')
		s.writes('RSET\r\n')
		const refused = s.refuseLogin()
		s.exchange('\r\n.\r\n', (done) => s.conn.data_end(done))
		s.loginSuccessfully()
		expect(refused).toHaveBeenCalledTimes(1)
	}
)

function beginManagedAuth(s: ReturnType<typeof scriptedSession>) {
	const done = s.login()
	s.writes(ehlo)
	s.reply('250', 'AUTH PLAIN')
	s.writes(auth)
	expect(done).not.toHaveBeenCalled()
	return done
}

it('refuses a second login after AUTH succeeds with 235', () => {
	const s = scriptedSession()
	const first = beginManagedAuth(s)
	s.reply('235', 'authenticated')
	expect(s.conn.authorized()).toBe(true)
	s.refuseLogin()
	expect(first).toHaveBeenCalledTimes(1)
	expect(first.mock.calls[0][0]).toBeNull()
})

it('does not authorize a managed login rejected with 503', () => {
	const s = scriptedSession()
	const first = beginManagedAuth(s)
	s.reply('503', 'bad sequence')
	expect(first).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
	expect(s.conn.authorized()).toBe(false)
})

it('keeps the envelope open when raw AUTH is rejected with 503', () => {
	const s = scriptedSession()
	s.greet()
	startEnvelope(s, 'command')
	const raw = vi.fn()
	s.conn.command('AUTH PLAIN', raw, 235)
	s.writes('AUTH PLAIN\r\n')
	s.reply('503', 'bad sequence')
	expect(raw).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
	const refused = s.refuseLogin()
	const reset = vi.fn()
	s.conn.rset(reset)
	s.writes('rset\r\n')
	s.reply('500', 'reset rejected')
	expect(reset).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
	const stillRefused = s.refuseLogin()
	s.exchange('rset\r\n', (done) => s.conn.rset(done))
	s.loginSuccessfully()
	expect(refused).toHaveBeenCalledTimes(1)
	expect(stillRefused).toHaveBeenCalledTimes(1)
})

it('does not use cached EHLO capabilities after successful raw HELO', () => {
	const s = scriptedSession()
	s.greet()
	s.exchange('HELO client.test\r\n', (done) =>
		s.conn.send('HELO client.test\r\n', done)
	)
	const login = s.login()
	// A fresh EHLO is safe, but the old AUTH advertisement is not.
	if (!login.mock.calls.length) {
		s.writes(ehlo)
		s.reply('250', 'hello')
	}
	s.writes()
	expect(login).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
})

it('refuses plaintext login while a manual STARTTLS reply is pending', () => {
	const s = scriptedSession()
	s.greet()
	const upgrade = vi.fn()
	s.conn.starttls(upgrade)
	s.writes('starttls\r\n')
	const refused = s.refuseLogin()
	expect(upgrade).not.toHaveBeenCalled()
	s.reply('454', 'TLS unavailable')
	expect(upgrade).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
	expect(refused).toHaveBeenCalledTimes(1)
	s.writes()
})

it('frames public noop as one command and passes through its raw reply', () => {
	const s = scriptedSession()
	s.greet()
	const noop = vi.fn()
	s.conn.noop(noop)
	s.writes('noop\r\n')
	expect(noop).not.toHaveBeenCalled()
	s.reply('250', 'OK')
	expect(noop).toHaveBeenCalledExactlyOnceWith(
		null,
		{ code: '250', message: 'OK', data: '250 OK' },
		undefined
	)
	s.loginSuccessfully()
})

it.each(['login', 'ehlo_or_helo_if_needed'] as const)(
	'%s does not send fallback HELO over a NOOP started by the EHLO rejection logger',
	(method) => {
		const noop = vi.fn()
		const s = scriptedSession((entry) => {
			if (
				typeof entry === 'object' &&
				entry &&
				'code' in entry &&
				entry.code === '500'
			)
				s.conn.command('NOOP', noop)
		})
		const done = vi.fn()
		s.conn[method](done)
		s.writes(ehlo)
		s.reply('500', 'EHLO not supported')
		s.writes('NOOP\r\n')
		expect(done).toHaveBeenCalledTimes(1)
		expect(done.mock.calls[0][0]).toBeInstanceOf(Error)
		expect(noop).not.toHaveBeenCalled()
		s.reply('250', 'OK')
		expect(noop).toHaveBeenCalledExactlyOnceWith(null, '250 OK', 'OK')
		expect(done).toHaveBeenCalledTimes(1)
		s.writes()
	}
)

it('lets NOOP own its reply when the outgoing fallback HELO logger sends it', () => {
	const noop = vi.fn()
	const s = scriptedSession((entry) => {
		if (entry === 'helo client.test\r\n') s.conn.noop(noop)
	})
	const done = vi.fn()
	s.conn.ehlo_or_helo_if_needed(done)
	s.writes(ehlo)
	s.reply('500', 'EHLO unavailable')
	s.writes('noop\r\n')
	expect(done).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
	s.reply('250', 'NOOP accepted')
	expect(noop).toHaveBeenCalledTimes(1)
	expect(done).toHaveBeenCalledTimes(1)
	s.writes()
})

it('falls back to HELO after an uncontended direct greeting rejection', () => {
	const s = scriptedSession()
	const done = vi.fn()
	s.conn.ehlo_or_helo_if_needed(done, 'legacy.test')
	s.writes('ehlo legacy.test\r\n')
	s.reply('500', 'EHLO not supported')
	s.writes('helo legacy.test\r\n')
	expect(done).not.toHaveBeenCalled()
	s.reply('250', 'hello')
	expect(done).toHaveBeenCalledExactlyOnceWith(null, '250 hello')
	s.writes()
})
