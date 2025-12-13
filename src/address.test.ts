import { describe, it, expect } from 'vitest'
import { addressparser } from './address.js'

describe('addressparser', () => {
	it('should handle single address correctly', () => {
		expect(addressparser('andris@tr.ee')).toEqual([
			{ address: 'andris@tr.ee', name: '' },
		])
	})

	it('should handle multiple addresses correctly', () => {
		expect(addressparser('andris@tr.ee, andris@example.com')).toEqual([
			{ address: 'andris@tr.ee', name: '' },
			{ address: 'andris@example.com', name: '' },
		])
	})

	it('should handle unquoted name correctly', () => {
		expect(addressparser('andris <andris@tr.ee>')).toEqual([
			{ name: 'andris', address: 'andris@tr.ee' },
		])
	})

	it('should handle quoted name correctly', () => {
		expect(addressparser('"reinman, andris" <andris@tr.ee>')).toEqual([
			{ name: 'reinman, andris', address: 'andris@tr.ee' },
		])
	})

	it('should handle quoted semicolons correctly', () => {
		expect(addressparser('"reinman; andris" <andris@tr.ee>')).toEqual([
			{ name: 'reinman; andris', address: 'andris@tr.ee' },
		])
	})

	it('should handle unquoted name, unquoted address correctly', () => {
		expect(addressparser('andris andris@tr.ee')).toEqual([
			{ name: 'andris', address: 'andris@tr.ee' },
		])
	})

	it('should handle empty group correctly', () => {
		expect(addressparser('Undisclosed:;')).toEqual([
			{ name: 'Undisclosed', group: [] },
		])
	})

	it('should handle address group correctly', () => {
		expect(
			addressparser('Disclosed:andris@tr.ee, andris@example.com;')
		).toEqual([
			{
				name: 'Disclosed',
				group: [
					{ address: 'andris@tr.ee', name: '' },
					{ address: 'andris@example.com', name: '' },
				],
			},
		])
	})

	it('should handle semicolon as a delimiter', () => {
		expect(addressparser('andris@tr.ee; andris@example.com;')).toEqual([
			{ address: 'andris@tr.ee', name: '' },
			{ address: 'andris@example.com', name: '' },
		])
	})

	it('should handle mixed group correctly', () => {
		expect(
			addressparser(
				'Test User <test.user@mail.ee>, Disclosed:andris@tr.ee, andris@example.com;,,,, Undisclosed:;'
			)
		).toEqual([
			{ address: 'test.user@mail.ee', name: 'Test User' },
			{
				name: 'Disclosed',
				group: [
					{ address: 'andris@tr.ee', name: '' },
					{ address: 'andris@example.com', name: '' },
				],
			},
			{ name: 'Undisclosed', group: [] },
		])
	})

	it('semicolon as delimiter should not break group parsing ', () => {
		expect(
			addressparser(
				'Test User <test.user@mail.ee>; Disclosed:andris@tr.ee, andris@example.com;,,,, Undisclosed:; bob@example.com;'
			)
		).toEqual([
			{ address: 'test.user@mail.ee', name: 'Test User' },
			{
				name: 'Disclosed',
				group: [
					{
						address: 'andris@tr.ee',
						name: '',
					},
					{
						address: 'andris@example.com',
						name: '',
					},
				],
			},
			{ name: 'Undisclosed', group: [] },
			{ address: 'bob@example.com', name: '' },
		])
	})

	it('should handle name from comment correctly', () => {
		expect(addressparser('andris@tr.ee (andris)')).toEqual([
			{ name: 'andris', address: 'andris@tr.ee' },
		])
	})

	it('should handle skip comment correctly', () => {
		expect(addressparser('andris@tr.ee (reinman) andris')).toEqual([
			{ name: 'andris', address: 'andris@tr.ee' },
		])
	})

	it('should handle missing address correctly', () => {
		expect(addressparser('andris')).toEqual([{ name: 'andris', address: '' }])
	})

	it('should handle apostrophe in name correctly', () => {
		expect(addressparser("O'Neill")).toEqual([{ name: "O'Neill", address: '' }])
	})

	it('should handle particularly bad input, unescaped colon correctly', () => {
		expect(
			addressparser(
				'FirstName Surname-WithADash :: Company <firstname@company.com>'
			)
		).toEqual([
			{
				name: 'FirstName Surname-WithADash',
				group: [
					{
						name: undefined,
						group: [{ address: 'firstname@company.com', name: 'Company' }],
					},
				],
			},
		])
	})
})
