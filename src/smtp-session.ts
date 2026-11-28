import type { Socket } from 'net'
import type { SMTPConnection } from './connection.js'

// The dial socket identifies the session even if STARTTLS wraps it later.
export const sessionSockets = new WeakMap<SMTPConnection, Socket>()

export function captureSessionCleanup(connection: SMTPConnection) {
	const socket = sessionSockets.get(connection)
	return () => {
		if (socket && sessionSockets.get(connection) === socket)
			connection.close(true)
	}
}
