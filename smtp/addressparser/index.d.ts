declare module 'addressparser' {
	const addressparser: (
		address?: string | string[],
		options?: { flatten: boolean }
	) => { name: string; address: string }[];
	export = addressparser;
}
