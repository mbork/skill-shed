// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {run_help} from './helpers.ts'

// * Help

test('help: no arguments prints general help', async () => {
	const result = await run_help()
	assert.strictEqual(result.code, 0)
	assert.ok(result.stdout.startsWith('skill-shed - manage and deploy agent skills'))
})

test('help: `help` command prints general help', async () => {
	const result = await run_help('help')
	assert.strictEqual(result.code, 0)
	assert.ok(result.stdout.startsWith('skill-shed - manage and deploy agent skills'))
})

test('help: `--help` flag prints general help', async () => {
	const result = await run_help('--help')
	assert.strictEqual(result.code, 0)
	assert.ok(result.stdout.startsWith('skill-shed - manage and deploy agent skills'))
})

test('help: `help init` prints init help', async () => {
	const result = await run_help('help', 'init')
	assert.strictEqual(result.code, 0)
	assert.ok(result.stdout.startsWith('Usage: skill-shed init'))
})

test('help: `-h init` prints init help', async () => {
	const result = await run_help('-h', 'init')
	assert.strictEqual(result.code, 0)
	assert.ok(result.stdout.startsWith('Usage: skill-shed init'))
})
