import module from 'module';
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';

export default {
	input: 'email.ts',
	output: [
		{
			entryFileNames: '[name].cjs',
			dir: 'dist',
			format: 'cjs',
			interop: false,
			freeze: false,
			sourcemap: true,
		},
		{
			entryFileNames: '[name].mjs',
			dir: 'dist',
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
		typescript({ include: ['email.ts', 'smtp/*.ts']})
	],
};
