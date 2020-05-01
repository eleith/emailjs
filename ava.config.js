export default {
	files: ['test/*.ts'],
	extensions: ['ts'],
	require: ['ts-node/register'],
	environmentVariables: {
		NODE_TLS_REJECT_UNAUTHORIZED: '0',
	},
};
