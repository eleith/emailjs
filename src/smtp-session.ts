import type { SMTPConnection } from './connection.js'
import type { SmtpTransport } from './smtp-transport.js'

export interface SmtpSession {
	close(): void
	closeWhenIdle(done: () => void): void
}

// One logical login session, including the switch from plaintext to STARTTLS.
const sessions = new WeakMap<SMTPConnection, SmtpSession>()

export function startSession(
	connection: SMTPConnection,
	currentTransport: () => SmtpTransport | null
) {
	const session: SmtpSession = {
		close() {
			if (sessions.get(connection) === session) connection.close(true)
		},
		closeWhenIdle(done) {
			const transport =
				sessions.get(connection) === session ? currentTransport() : null
			if (!transport) return done()
			transport.whenIdle(() => {
				// STARTTLS may have moved the same session to a TLS transport.
				if (
					sessions.get(connection) === session &&
					currentTransport() !== transport
				)
					return session.closeWhenIdle(done)
				session.close()
				done()
			})
		},
	}
	sessions.set(connection, session)
}

export function endSession(connection: SMTPConnection) {
	sessions.delete(connection)
}

export function getSession(connection: SMTPConnection) {
	return sessions.get(connection)
}
