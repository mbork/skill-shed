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
			'curly': 'error',
			'dot-notation': 'error',
		},
	},
)
