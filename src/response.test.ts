import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import { SMTPResponseMonitor } from './response.js'
import { SMTPError, SMTPErrorStates } from './error.js'
import { Socket } from 'net'

// Mock Socket/TLSSocket interface
interface MockStream extends EventEmitter {
	end: ReturnType<typeof vi.fn>
	setTimeout: ReturnType<typeof vi.fn>
	authorized?: boolean
	emit(event: string | symbol, ...args: unknown[]): boolean
}

describe('SMTPResponseMonitor', () => {
	let mockStream: MockStream
	let mockOnError: (err: Error) => void
	const TIMEOUT = 1000
	let timeoutCallback: () => void // Store the callback passed to setTimeout

	beforeEach(() => {
		mockStream = new EventEmitter() as MockStream
		mockStream.end = vi.fn()
		// Mock setTimeout to capture the callback without actually waiting
		mockStream.setTimeout = vi.fn((_timeout, callback) => {
			timeoutCallback = callback as () => void // Store the callback
		})
		mockOnError = vi.fn() as (err: Error) => void
	})

	it('should parse and emit a valid SMTP response', () => {
		const monitor = new SMTPResponseMonitor(
			mockStream as unknown as Socket,
			TIMEOUT,
			mockOnError
		)
		const responseSpy = vi.fn()
		mockStream.on('response', responseSpy)

		mockStream.emit('data', '220 Service ready\r\n')

		expect(responseSpy).toHaveBeenCalledTimes(1)
		expect(responseSpy).toHaveBeenCalledWith(null, {
			code: '220',
			message: 'Service ready',
			data: '220 Service ready\n', // Corrected expectation for data field (no \r)
		})
		monitor.stop()
	})

	it('should parse multi-line SMTP response', () => {
		const monitor = new SMTPResponseMonitor(
			mockStream as unknown as Socket,
			TIMEOUT,
			mockOnError
		)
		const responseSpy = vi.fn()
		mockStream.on('response', responseSpy)

		mockStream.emit('data', '250-hostname\r\n')
		mockStream.emit('data', '250-PIPELINING\r\n')
		mockStream.emit('data', '250 HELP\r\n')

		expect(responseSpy).toHaveBeenCalledTimes(1)
		expect(responseSpy).toHaveBeenCalledWith(null, {
			code: '250',
			message: 'HELP',
			data: '250-hostname\n250-PIPELINING\n250 HELP\n', // Corrected expectation for data field (no \r)
		})
		monitor.stop()
	})

	it('should not emit response for incomplete lines', () => {
		const monitor = new SMTPResponseMonitor(
			mockStream as unknown as Socket,
			TIMEOUT,
			mockOnError
		)
		const responseSpy = vi.fn()
		mockStream.on('response', responseSpy)

		mockStream.emit('data', '220 Service re')
		expect(responseSpy).not.toHaveBeenCalled() // Should not have been called yet

		mockStream.emit('data', 'ady\r\n') // Complete the line

		expect(responseSpy).toHaveBeenCalledTimes(1)
		expect(responseSpy).toHaveBeenCalledWith(null, {
			code: '220',
			message: 'Service ready',
			data: '220 Service ready\n', // Corrected expectation for data field (no \r)
		})
		monitor.stop()
	})

	it('should handle non-standard responses (no code)', () => {
		const monitor = new SMTPResponseMonitor(
			mockStream as unknown as Socket,
			TIMEOUT,
			mockOnError
		)
		const responseSpy = vi.fn()
		mockStream.on('response', responseSpy)

		mockStream.emit('data', 'Some random message\r\n')

		expect(responseSpy).not.toHaveBeenCalled() // No 3-digit code
		monitor.stop()
	})

	it('should emit error on stream "error" event', () => {
		const monitor = new SMTPResponseMonitor(
			mockStream as unknown as Socket,
			TIMEOUT,
			mockOnError
		)
		const responseSpy = vi.fn()
		mockStream.on('response', responseSpy)
		const testError = new Error('Socket error')

		mockStream.emit('error', testError)

		expect(responseSpy).toHaveBeenCalledTimes(1)
		const emittedError = responseSpy.mock.calls[0][0]
		expect(emittedError).toBeInstanceOf(SMTPError)
		expect(emittedError.message).toBe(
			'connection encountered an error (Socket error)'
		)
		expect(emittedError.code).toBe(SMTPErrorStates.ERROR)
		expect(emittedError.previous).toBe(testError)
		monitor.stop()
	})

	it('should emit error on stream "close" event', () => {
		const monitor = new SMTPResponseMonitor(
			mockStream as unknown as Socket,
			TIMEOUT,
			mockOnError
		)
		const responseSpy = vi.fn()
		mockStream.on('response', responseSpy)
		const testError = new Error('Socket closed')

		mockStream.emit('close', testError)

		expect(responseSpy).toHaveBeenCalledTimes(1)
		const emittedError = responseSpy.mock.calls[0][0]
		expect(emittedError).toBeInstanceOf(SMTPError)
		expect(emittedError.message).toBe('connection has closed (Socket closed)')
		expect(emittedError.code).toBe(SMTPErrorStates.CONNECTIONCLOSED)
		expect(emittedError.previous).toBe(testError)
		monitor.stop()
	})

	it('should emit error on stream "end" event', () => {
		const monitor = new SMTPResponseMonitor(
			mockStream as unknown as Socket,
			TIMEOUT,
			mockOnError
		)
		const responseSpy = vi.fn()
		mockStream.on('response', responseSpy)
		const testError = new Error('Socket ended')

		mockStream.emit('end', testError)

		expect(responseSpy).toHaveBeenCalledTimes(1)
		const emittedError = responseSpy.mock.calls[0][0]
		expect(emittedError).toBeInstanceOf(SMTPError)
		expect(emittedError.message).toBe('connection has ended (Socket ended)')
		expect(emittedError.code).toBe(SMTPErrorStates.CONNECTIONENDED)
		expect(emittedError.previous).toBe(testError)
		monitor.stop()
	})

	it('should stop listening to events when stop is called', () => {
		const monitor = new SMTPResponseMonitor(
			mockStream as unknown as Socket,
			TIMEOUT,
			mockOnError
		)
		const responseSpy = vi.fn()
		mockStream.on('response', responseSpy)

		// Add a generic error handler to the mock stream to prevent unhandled promise rejections
		// if errors are emitted after monitor stops listening.
		mockStream.on('error', () => { })

		monitor.stop()

		mockStream.emit('data', '220 Service ready\r\n')
		mockStream.emit('error', new Error('test'))
		mockStream.emit('close')
		mockStream.emit('end')

		expect(responseSpy).not.toHaveBeenCalled()
		expect(mockOnError).not.toHaveBeenCalled()
	})

	it('should call onerror callback when stop is called with an error', () => {
		const monitor = new SMTPResponseMonitor(
			mockStream as unknown as Socket,
			TIMEOUT,
			mockOnError
		)
		const testError = new Error('Stop error')

		monitor.stop(testError)

		expect(mockOnError).toHaveBeenCalledTimes(1)
		expect(mockOnError).toHaveBeenCalledWith(testError)
	})

	it('should cover empty line in buffer', () => {
		const monitor = new SMTPResponseMonitor(
			mockStream as unknown as Socket,
			TIMEOUT,
			mockOnError
		)
		const responseSpy = vi.fn()
		mockStream.on('response', responseSpy)

		mockStream.emit('data', '250-line1\r\n\r\n250 lastline\r\n')

		expect(responseSpy).toHaveBeenCalledTimes(1)
		expect(responseSpy).toHaveBeenCalledWith(null, {
			code: '250',
			message: 'lastline',
			data: '250-line1\n\n250 lastline\n',
		})
		monitor.stop()
	})

	it('should cover timeout handling', () => {
		const monitor = new SMTPResponseMonitor(
			mockStream as unknown as Socket,
			TIMEOUT,
			mockOnError
		)
		const responseSpy = vi.fn()
		mockStream.on('response', responseSpy)

		// Manually trigger the stored timeout callback
		if (timeoutCallback) {
			timeoutCallback()
		} else {
			// Fail test if callback not set (should not happen with setTimeout mock)
			expect.fail('Timeout callback was not set.')
		}

		expect(mockStream.end).toHaveBeenCalledTimes(1)
		expect(responseSpy).toHaveBeenCalledTimes(1)
		const emittedError = responseSpy.mock.calls[0][0]
		expect(emittedError).toBeInstanceOf(SMTPError)
		expect(emittedError.message).toBe(
			'timedout while connecting to smtp server'
		)
		expect(emittedError.code).toBe(SMTPErrorStates.TIMEDOUT)
		expect(emittedError.previous).toBeNull() // Corrected expectation
		monitor.stop()
	})
})
