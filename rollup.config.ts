import { builtinModules } from 'module';
import typescript from '@rollup/plugin-typescript';

export default {
	input: 'email.ts',
	output: {
		file: 'email.js',
		format: 'es',
		sourcemap: true,
	},
	external: builtinModules,
	plugins: [
		typescript({ removeComments: false, include: ['email.ts', 'smtp/*'] }),
	],
};
