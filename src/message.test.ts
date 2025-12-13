import { describe, it, expect } from 'vitest'
import { Message } from './message.js'

describe('Message', () => {
	it('message validation fails without `from` header', () => {
		const msg = new Message({})
		const { isValid, validationError } = msg.checkValidity()
		expect(isValid).toBe(false)
		expect(validationError).toBe('Message must have a `from` header')
	})

	it('message validation fails without `to`, `cc`, or `bcc` header', () => {
		const { isValid, validationError } = new Message({
			from: 'piglet@gmail.com',
		}).checkValidity()

		expect(isValid).toBe(false)
		expect(validationError).toBe(
			'Message must have at least one `to`, `cc`, or `bcc` header'
		)
	})

	it('message validation succeeds with only `to` recipient header (string)', () => {
		const { isValid, validationError } = new Message({
			from: 'piglet@gmail.com',
			to: 'pooh@gmail.com',
		}).checkValidity()

		expect(isValid).toBe(true)
		expect(validationError).toBeUndefined()
	})

	it('message validation succeeds with only `to` recipient header (array)', () => {
		const { isValid, validationError } = new Message({
			from: 'piglet@gmail.com',
			to: ['pooh@gmail.com'],
		}).checkValidity()

		expect(isValid).toBe(true)
		expect(validationError).toBeUndefined()
	})

	it('message validation succeeds with only `cc` recipient header (string)', () => {
		const { isValid, validationError } = new Message({
			from: 'piglet@gmail.com',
			cc: 'pooh@gmail.com',
		}).checkValidity()

		expect(isValid).toBe(true)
		expect(validationError).toBeUndefined()
	})

	it('message validation succeeds with only `cc` recipient header (array)', () => {
		const { isValid, validationError } = new Message({
			from: 'piglet@gmail.com',
			cc: ['pooh@gmail.com'],
		}).checkValidity()

		expect(isValid).toBe(true)
		expect(validationError).toBeUndefined()
	})

	it('message validation succeeds with only `bcc` recipient header (string)', () => {
		const { isValid, validationError } = new Message({
			from: 'piglet@gmail.com',
			bcc: 'pooh@gmail.com',
		}).checkValidity()

		expect(isValid).toBe(true)
		expect(validationError).toBeUndefined()
	})

	it('message validation succeeds with only `bcc` recipient header (array)', () => {
		const { isValid, validationError } = new Message({
			from: 'piglet@gmail.com',
			bcc: ['pooh@gmail.com'],
		}).checkValidity()

		expect(isValid).toBe(true)
		expect(validationError).toBeUndefined()
	})
})
