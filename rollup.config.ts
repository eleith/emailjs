import module from 'module';
import typescript from '@rollup/plugin-typescript';

export default {
	input: 'email.ts',
	output: [
		{
			file: 'rollup/email.cjs',
			format: 'cjs',
			interop: 'default',
			sourcemap: true,
		},
		{
			file: 'rollup/email.mjs',
			format: 'es',
			sourcemap: true,
		},
	],
	external: module.builtinModules,
	plugins: [
		typescript({ removeComments: false, include: ['email.ts', 'smtp/**/*'] }),
	],
};
