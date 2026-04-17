// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {run_script} from './helpers.ts'

// * Help

test('help: no arguments prints general help', async () => {
	const result = await run_script([])
	assert.strictEqual(result.code, 0)
	assert.ok(result.stdout.startsWith('skill-shed - manage and deploy agent skills'))
})

test('help: `help` command prints general help', async () => {
	const result = await run_script(['help'])
	assert.strictEqual(result.code, 0)
	assert.ok(result.stdout.startsWith('skill-shed - manage and deploy agent skills'))
})

test('help: `--help` flag prints general help', async () => {
	const result = await run_script(['--help'])
	assert.strictEqual(result.code, 0)
	assert.ok(result.stdout.startsWith('skill-shed - manage and deploy agent skills'))
})

test('help: `help init` prints init help', async () => {
	const result = await run_script(['help', 'init'])
	assert.strictEqual(result.code, 0)
	assert.ok(result.stdout.startsWith('Usage: skill-shed init'))
})

test('help: `-h init` prints init help', async () => {
	const result = await run_script(['-h', 'init'])
	assert.strictEqual(result.code, 0)
	assert.ok(result.stdout.startsWith('Usage: skill-shed init'))
})
