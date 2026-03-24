import ts_eslint from 'typescript-eslint';

export default ts_eslint.config(
	ts_eslint.configs.recommended,
	ts_eslint.configs.stylistic,
);
