import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['src/**/*.test.ts'],
		typecheck: {
			tsconfig: './tsconfig.modern.json',
		},
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			include: ['src/**/*.ts'],
			exclude: ['src/**/*.test.ts', 'src/index.ts'],
			thresholds: {
				functions: 80,
				lines: 80,
				branches: 80,
				statements: 80,
			}
		},
	},
})
