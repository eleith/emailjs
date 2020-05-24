require('ts-node/register');
if (process.title === 'cjs') {
	require('./rollup/email.cjs');
	require.cache[require.resolve('./email.ts')] =
		require.cache[require.resolve('./rollup/email.cjs')];
	console.log('Testing email.cjs...\n');
}
