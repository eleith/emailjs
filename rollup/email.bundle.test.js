require('./email.bundle.js');
require.cache[require.resolve('../email.js')] =
	require.cache[require.resolve('./email.bundle.js')];
console.log('Testing email.bundle.js...');
