import { isIP, type Socket } from 'net'
import {
	connect,
	createSecureContext,
	type SecureContextOptions,
	type TLSSocket,
} from 'tls'
import { SMTPError, SMTPErrorStates } from './error.js'

export function startTlsHandshake(
	socket: Socket,
	relayHost: string,
	options: SecureContextOptions & { rejectUnauthorized?: boolean },
	timeout: number,
	onHandshake: (err: Error | null, tlsSocket: TLSSocket) => void
): TLSSocket {
	// Verify relayHost even for IP addresses, which are not sent in SNI.
	const sniServerName = isIP(relayHost) ? undefined : relayHost
	const tlsSocket = connect({
		socket,
		host: relayHost,
		servername: sniServerName,
		secureContext: createSecureContext(options),
		rejectUnauthorized: options.rejectUnauthorized !== false,
	})

	const finishHandshake = (err: Error | null) => {
		tlsSocket.off('secureConnect', onSecureConnect)
		tlsSocket.off('error', finishHandshake)
		tlsSocket.off('close', closed)
		tlsSocket.off('timeout', timedOut)
		onHandshake(err, tlsSocket)
	}
	const onSecureConnect = () => finishHandshake(null)
	const closed = () =>
		finishHandshake(
			SMTPError.create(
				'connection closed during STARTTLS handshake',
				SMTPErrorStates.CONNECTIONCLOSED
			)
		)
	const timedOut = () =>
		tlsSocket.destroy(
			SMTPError.create(
				'timed out during STARTTLS handshake',
				SMTPErrorStates.TIMEDOUT
			)
		)

	tlsSocket.once('secureConnect', onSecureConnect)
	tlsSocket.once('error', finishHandshake)
	tlsSocket.once('close', closed)
	tlsSocket.setTimeout(timeout, timedOut)
	return tlsSocket
}
