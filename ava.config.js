export default {
	files: ['test/*.ts'],
	extensions: ['ts'],
	require: ['./email.test.ts'],
	environmentVariables: {
		NODE_TLS_REJECT_UNAUTHORIZED: '0',
	},
};
