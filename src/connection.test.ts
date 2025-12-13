import { describe, it, expect } from 'vitest'
import { SMTPConnection } from './connection.js'

describe('SMTPConnection', () => {
	it('accepts a custom logger', () => {
		const logger = () => {}
		const connection = new SMTPConnection({ logger })
		// Accessing protected member for testing purpose (using any cast or Reflect)
		expect(Reflect.get(connection, 'log')).toBe(logger)
	})
})
