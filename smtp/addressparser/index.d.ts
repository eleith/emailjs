/* eslint-disable no-var */
declare module 'addressparser' {
	var addressparser: (
		address?: string | string[]
	) => { name: string; address: string }[];
	export = addressparser;
}
