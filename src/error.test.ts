import { describe, it, expect } from 'vitest'
import { SMTPError, SMTPErrorStates } from './error.js'

describe('SMTPError', () => {
	it('should create an error with message and code', () => {
		const err = SMTPError.create('boom', SMTPErrorStates.ERROR)
		expect(err).toBeInstanceOf(SMTPError)
		expect(err.message).toBe('boom')
		expect(err.code).toBe(SMTPErrorStates.ERROR)
		expect(err.previous).toBeNull()
	})

	it('should include previous error message', () => {
		const prev = new Error('original sin')
		const err = SMTPError.create('fail', SMTPErrorStates.AUTHFAILED, prev)
		expect(err.message).toBe('fail (original sin)')
		expect(err.previous).toBe(prev)
	})

	it('should attach smtp context', () => {
		const context = { foo: 'bar' }
		const err = SMTPError.create(
			'fail',
			SMTPErrorStates.TIMEDOUT,
			null,
			context
		)
		expect(err.smtp).toBe(context)
	})
})
