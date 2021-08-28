/* global process */
const useCjsConfig =
	process.version.startsWith('v10') ||
	process.argv.includes('--node-arguments=--title=cjs');

export default {
	files: ['test/*.ts'],
	extensions: useCjsConfig ? ['ts'] : { ts: 'module' },
	require: useCjsConfig ? ['./email.test.ts'] : undefined,
	environmentVariables: {
		NODE_TLS_REJECT_UNAUTHORIZED: '0',
	},
	nonSemVerExperiments: useCjsConfig ? {} : { configurableModuleFormat: true },
	nodeArguments: useCjsConfig
		? undefined
		: ['--loader=ts-node/esm', '--experimental-specifier-resolution=node'],
};
