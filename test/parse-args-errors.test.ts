// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {run_script} from './helpers.ts'

// * parseArgs error reporting
// Node's `parseArgs` throws three error codes. `ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL`
// is unreachable because skill-shed.ts passes `allowPositionals: true`.

test('parseArgs error: option-like value for string option is reported cleanly', async () => {
	const result = await run_script(['deploy', '--ref', '--force'])
	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /^Error: /)
	assert.match(result.stderr, /--ref/)
	assert.doesNotMatch(result.stderr, /at parseArgs/)
})

test('parseArgs error: unknown option is reported cleanly', async () => {
	const result = await run_script(['deploy', '--bogus'])
	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /^Error: /)
	assert.match(result.stderr, /--bogus/)
	assert.doesNotMatch(result.stderr, /at parseArgs/)
})

// * CLI-level mutex validation

test('--comments and --no-comments together exits 1', async () => {
	const result = await run_script(['init', 'some-dir', '--comments', '--no-comments'])
	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /--comments and --no-comments are mutually exclusive/)
})

test('--clean and --workdir together exits 1', async () => {
	const result = await run_script(['deploy', 'some-dir', '--clean', '--workdir'])
	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /--clean, --workdir, --staged, and --ref are mutually exclusive/)
})

// * Unknown subcommand

test('unknown subcommand exits 1 with help', async () => {
	const result = await run_script(['bogus'])
	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /Unknown command: bogus/)
})
