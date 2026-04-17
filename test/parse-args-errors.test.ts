// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {run_cli} from './helpers.ts'

// * parseArgs error reporting
// Node's `parseArgs` throws three error codes. `ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL`
// is unreachable because skill-shed.ts passes `allowPositionals: true`.

test('parseArgs error: option-like value for string option is reported cleanly', async () => {
	const result = await run_cli('deploy', '--ref', '--force')
	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /^Error: /)
	assert.match(result.stderr, /--ref/)
	assert.doesNotMatch(result.stderr, /at parseArgs/)
})

test('parseArgs error: unknown option is reported cleanly', async () => {
	const result = await run_cli('deploy', '--bogus')
	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /^Error: /)
	assert.match(result.stderr, /--bogus/)
	assert.doesNotMatch(result.stderr, /at parseArgs/)
})
