import { SMTPError, SMTPErrorStates, type SMTPErrorState } from './error.js'
import type { Socket } from 'net'
import type { TLSSocket } from 'tls'

const CRLF = '\r\n' // Define CRLF here for consistency

export class SMTPResponseMonitor {
	public readonly stop: (err?: Error) => void

	constructor(
		stream: Socket | TLSSocket,
		timeout: number,
		onerror: (err: Error) => void
	) {
		let buffer = ''

		const notify = () => {
			const lines = buffer.split(CRLF)
			let processedChars = 0

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i]
				// If it's an empty line and not the very last line, it's just padding, skip it.
				// If it's the very last line and empty, it means we have `\r\n\r\n` and should not process further.
				if (!line.length && i < lines.length - 1) {
					processedChars += line.length + CRLF.length
					continue
				}

				// Look for an SMTP response line pattern:
				// ^(\d{3})  -> 3-digit code
				// ([ -])   -> space for final line, hyphen for multi-line continuation
				// (.*)$    -> rest of the message
				const match = line.match(/^(\d{3})([ -])(.*)$/)

				if (match) {
					const code = match[1]
					const separator = match[2]
					const message = match[3]

					if (separator === ' ') {
						// This is a final line of an SMTP response
						// If this is the very last line in the current buffer, and the buffer does not end with CRLF,
						// then this line is incomplete and we should not process it yet.
						if (i === lines.length - 1 && !buffer.endsWith(CRLF)) {
							// Defer emission as the line is not fully received yet
							processedChars += line.length + CRLF.length
							continue
						}
						const replyEnd = processedChars + line.length + CRLF.length
						const data = buffer.substring(0, replyEnd).replace(/\r/g, '')
						buffer = buffer.substring(replyEnd)
						stream.emit('response', null, {
							code,
							message: message.trim(),
							data,
						})
						return // Only process one full response at a time
					}
					// If it's a multi-line response (separator is '-'), we continue accumulating in the buffer.
					// We only emit a response when a final line (' ') is encountered.
				}
				processedChars += line.length + CRLF.length
			}
		}

		const disconnect = (
			message: string,
			code: SMTPErrorState,
			cause?: Error
		) => {
			const err = SMTPError.create(message, code, cause)
			// Stop resets the connection and clears its listeners. Report the error
			// afterward so a command callback cannot reuse the failed socket.
			const pendingResponses = stream.rawListeners('response')
			this.stop(err)
			for (const respond of pendingResponses) respond.call(stream, err)
		}

		const error = (err: Error) =>
			disconnect('connection encountered an error', SMTPErrorStates.ERROR, err)

		const timedout = (err?: Error) => {
			stream.end()
			disconnect(
				'timedout while connecting to smtp server',
				SMTPErrorStates.TIMEDOUT,
				err
			)
		}

		const watch = (data: string | Buffer) => {
			if (data !== null) {
				buffer += data.toString()
				notify()
			}
		}

		const close = (err: Error) =>
			disconnect('connection has closed', SMTPErrorStates.CONNECTIONCLOSED, err)

		const end = (err: Error) =>
			disconnect('connection has ended', SMTPErrorStates.CONNECTIONENDED, err)

		this.stop = (err) => {
			stream.removeAllListeners('response')
			stream.removeListener('data', watch)
			stream.removeListener('end', end)
			stream.removeListener('close', close)
			stream.removeListener('error', error)
			stream.removeListener('timeout', timedout)

			if (err != null && typeof onerror === 'function') {
				onerror(err)
			}
		}

		stream.on('data', watch)
		stream.on('end', end)
		stream.on('close', close)
		stream.on('error', error)
		stream.setTimeout(timeout, timedout)
	}
}
