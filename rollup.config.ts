import module from 'module';
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';

export default {
	input: 'email.ts',
	output: [
		{
			file: 'rollup/email.cjs',
			format: 'cjs',
			interop: false,
			freeze: false,
			sourcemap: true,
		},
		{
			file: 'rollup/email.mjs',
			format: 'es',
			interop: false,
			freeze: false,
			sourcemap: true,
		},
	],
	external: module.builtinModules,
	plugins: [
		resolve(),
		commonjs(),
		typescript({ removeComments: false, include: ['email.ts', 'smtp/**/*'] }),
	],
};
