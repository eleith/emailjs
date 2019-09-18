import { builtinModules as external } from 'module';
import commonjs from 'rollup-plugin-commonjs';
import resolve from 'rollup-plugin-node-resolve';

export default {
  input: 'email.js',
  output: {
    file: 'rollup/email.bundle.js',
		format: 'cjs',
		interop: false,
		freeze: false,
	},
	external,
  plugins: [
		resolve(),
		commonjs(),
  ]
};
