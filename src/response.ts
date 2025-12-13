import { SMTPError, SMTPErrorStates } from './error.js'
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
			let responseFound = false

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
						stream.emit('response', null, {
							code: code,
							message: message.trim(),
							data: buffer
								.substring(0, processedChars + line.length + CRLF.length)
								.replace(/\r/g, ''), // Send the full data for this response
						})
						responseFound = true
						processedChars += line.length + CRLF.length
						break // Only process one full response at a time
					}
					// If it's a multi-line response (separator is '-'), we continue accumulating in the buffer.
					// We only emit a response when a final line (' ') is encountered.
				}
				processedChars += line.length + CRLF.length
			}

			if (responseFound) {
				buffer = buffer.substring(processedChars) // Remove the processed part from the buffer
			}
		}

		const error = (err: Error) => {
			stream.emit(
				'response',
				SMTPError.create(
					'connection encountered an error',
					SMTPErrorStates.ERROR,
					err
				)
			)
		}

		const timedout = (err?: Error) => {
			stream.end()
			stream.emit(
				'response',
				SMTPError.create(
					'timedout while connecting to smtp server',
					SMTPErrorStates.TIMEDOUT,
					err
				)
			)
		}

		const watch = (data: string | Buffer) => {
			if (data !== null) {
				buffer += data.toString()
				notify()
			}
		}

		const close = (err: Error) => {
			stream.emit(
				'response',
				SMTPError.create(
					'connection has closed',
					SMTPErrorStates.CONNECTIONCLOSED,
					err
				)
			)
		}

		const end = (err: Error) => {
			stream.emit(
				'response',
				SMTPError.create(
					'connection has ended',
					SMTPErrorStates.CONNECTIONENDED,
					err
				)
			)
		}

		this.stop = (err) => {
			stream.removeAllListeners('response')
			stream.removeListener('data', watch)
			stream.removeListener('end', end)
			stream.removeListener('close', close)
			stream.removeListener('error', error)

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
