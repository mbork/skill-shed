import ts_eslint from 'typescript-eslint'
import stylistic from '@stylistic/eslint-plugin'

export default ts_eslint.config(
	ts_eslint.configs.recommended,
	ts_eslint.configs.stylistic,
	stylistic.configs.recommended,
	{
		rules: {
			'@stylistic/indent': ['error', 'tab'],
			'@stylistic/indent-binary-ops': ['error', 'tab'],
			'@stylistic/no-tabs': ['error', {allowIndentationTabs: true}],
			'@stylistic/object-curly-spacing': ['error', 'never'],
			'@stylistic/brace-style': ['error', '1tbs'],
			'@stylistic/max-len': ['error', {code: 100, tabWidth: 4}],
			'curly': 'error',
			'dot-notation': 'error',
			'@typescript-eslint/no-unused-vars': ['error', {
				argsIgnorePattern: '^_',
				varsIgnorePattern: '^_',
			}],
			'max-depth': 'warn',
			'max-nested-callbacks': ['warn', {max: 2}],
		},
	},
	{
		files: ['test/**/*.ts'],
		rules: {
			'@stylistic/max-len': 'off',
		},
	},
)
