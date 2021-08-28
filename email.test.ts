// eslint-disable-next-line @typescript-eslint/no-var-requires
require('ts-node').register({
	moduleTypes: {
		'test/*.ts': 'cjs',
	},
	compilerOptions: {
		module: 'commonjs',
	},
});
if (process.title === 'cjs') {
	require('./rollup/email.cjs');
	require.cache[require.resolve('./email.ts')] =
		require.cache[require.resolve('./rollup/email.cjs')];
	console.log('Testing email.cjs...\n');
}
