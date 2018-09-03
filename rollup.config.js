import commonjs from 'rollup-plugin-commonjs';
import resolve from 'rollup-plugin-node-resolve';

export default {
  input: 'email.esm.js',
  output: {
    file: 'rollup/email.bundle.js',
		format: 'cjs',
		interop: false,
		freeze: false,
	},
	external: require('module').builtinModules,
  plugins: [
		resolve(),
		commonjs(),
  ]
};
