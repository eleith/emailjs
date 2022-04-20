import test from 'ava';
import { addressparser } from '../email.js';

test('addressparser should handle single address correctly', async (t) => {
	t.deepEqual(addressparser('andris@tr.ee'), [
		{ address: 'andris@tr.ee', name: '' },
	]);
});

test('addressparser should handle multiple addresses correctly', async (t) => {
	t.deepEqual(addressparser('andris@tr.ee, andris@example.com'), [
		{ address: 'andris@tr.ee', name: '' },
		{ address: 'andris@example.com', name: '' },
	]);
});

test('addressparser should handle unquoted name correctly', async (t) => {
	t.deepEqual(addressparser('andris <andris@tr.ee>'), [
		{ name: 'andris', address: 'andris@tr.ee' },
	]);
});

test('addressparser should handle quoted name correctly', async (t) => {
	t.deepEqual(addressparser('"reinman, andris" <andris@tr.ee>'), [
		{ name: 'reinman, andris', address: 'andris@tr.ee' },
	]);
});

test('addressparser should handle quoted semicolons correctly', async (t) => {
	t.deepEqual(addressparser('"reinman; andris" <andris@tr.ee>'), [
		{ name: 'reinman; andris', address: 'andris@tr.ee' },
	]);
});

test('addressparser should handle unquoted name, unquoted address correctly', async (t) => {
	t.deepEqual(addressparser('andris andris@tr.ee'), [
		{ name: 'andris', address: 'andris@tr.ee' },
	]);
});

test('addressparser should handle empty group correctly', async (t) => {
	t.deepEqual(addressparser('Undisclosed:;'), [
		{ name: 'Undisclosed', group: [] },
	]);
});

test('addressparser should handle address group correctly', async (t) => {
	t.deepEqual(addressparser('Disclosed:andris@tr.ee, andris@example.com;'), [
		{
			name: 'Disclosed',
			group: [
				{ address: 'andris@tr.ee', name: '' },
				{ address: 'andris@example.com', name: '' },
			],
		},
	]);
});

test('addressparser should handle semicolon as a delimiter', async (t) => {
	t.deepEqual(addressparser('andris@tr.ee; andris@example.com;'), [
		{ address: 'andris@tr.ee', name: '' },
		{ address: 'andris@example.com', name: '' },
	]);
});

test('addressparser should handle mixed group correctly', async (t) => {
	t.deepEqual(
		addressparser(
			'Test User <test.user@mail.ee>, Disclosed:andris@tr.ee, andris@example.com;,,,, Undisclosed:;'
		),
		[
			{ address: 'test.user@mail.ee', name: 'Test User' },
			{
				name: 'Disclosed',
				group: [
					{ address: 'andris@tr.ee', name: '' },
					{ address: 'andris@example.com', name: '' },
				],
			},
			{ name: 'Undisclosed', group: [] },
		]
	);
});

test('addressparser semicolon as delimiter should not break group parsing ', async (t) => {
	t.deepEqual(
		addressparser(
			'Test User <test.user@mail.ee>; Disclosed:andris@tr.ee, andris@example.com;,,,, Undisclosed:; bob@example.com;'
		),
		[
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
		]
	);
});

test('addressparser should handle name from comment correctly', async (t) => {
	t.deepEqual(addressparser('andris@tr.ee (andris)'), [
		{ name: 'andris', address: 'andris@tr.ee' },
	]);
});

test('addressparser should handle skip comment correctly', async (t) => {
	t.deepEqual(addressparser('andris@tr.ee (reinman) andris'), [
		{ name: 'andris', address: 'andris@tr.ee' },
	]);
});

test('addressparser should handle missing address correctly', async (t) => {
	t.deepEqual(addressparser('andris'), [{ name: 'andris', address: '' }]);
});

test('addressparser should handle apostrophe in name correctly', async (t) => {
	t.deepEqual(addressparser("O'Neill"), [{ name: "O'Neill", address: '' }]);
});

test('addressparser should handle particularly bad input, unescaped colon correctly', async (t) => {
	t.deepEqual(
		addressparser(
			'FirstName Surname-WithADash :: Company <firstname@company.com>'
		),
		[
			{
				name: 'FirstName Surname-WithADash',
				group: [
					{
						name: undefined,
						group: [{ address: 'firstname@company.com', name: 'Company' }],
					},
				],
			},
		]
	);
});
