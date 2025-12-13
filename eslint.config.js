import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
	js.configs.recommended,
	...tseslint.configs.recommended,
	prettier,
	{
		ignores: [
			'dist/',
			'node_modules/',
			'coverage/',
			'email.js',
			'email.ts',
			'smtp/',
			'test/',
		],
	}
)
