import { describe, it, expect } from 'vitest'
import { getRFC2822Date, getRFC2822DateUTC, isRFC2822Date } from './date.js'

const toD_utc = (dt: number) => getRFC2822DateUTC(new Date(dt))
const toD = (dt: number, utc = false) => getRFC2822Date(new Date(dt), utc)

describe('rfc2822', () => {
	it('non-UTC', () => {
		expect(isRFC2822Date(toD(0))).toBe(true)
		expect(isRFC2822Date(toD(329629726785))).toBe(true)
		expect(isRFC2822Date(toD(729629726785))).toBe(true)
		expect(isRFC2822Date(toD(1129629726785))).toBe(true)
		expect(isRFC2822Date(toD(1529629726785))).toBe(true)
	})

	it('UTC', () => {
		expect(toD_utc(0)).toBe('Thu, 01 Jan 1970 00:00:00 +0000')
		expect(toD_utc(0)).toBe(toD(0, true))

		expect(toD_utc(329629726785)).toBe('Thu, 12 Jun 1980 03:48:46 +0000')
		expect(toD_utc(329629726785)).toBe(toD(329629726785, true))

		expect(toD_utc(729629726785)).toBe('Sat, 13 Feb 1993 18:55:26 +0000')
		expect(toD_utc(729629726785)).toBe(toD(729629726785, true))

		expect(toD_utc(1129629726785)).toBe('Tue, 18 Oct 2005 10:02:06 +0000')
		expect(toD_utc(1129629726785)).toBe(toD(1129629726785, true))

		expect(toD_utc(1529629726785)).toBe('Fri, 22 Jun 2018 01:08:46 +0000')
		expect(toD_utc(1529629726785)).toBe(toD(1529629726785, true))
	})
})
