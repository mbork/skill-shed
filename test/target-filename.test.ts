// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {target_filename} from '../src/manifest.ts'

// * target_filename

test('target_filename: .md unchanged', () => {
	assert.strictEqual(target_filename('SKILL.md'), 'SKILL.md')
})

test('target_filename: .source.md → .md', () => {
	assert.strictEqual(target_filename('SKILL.source.md'), 'SKILL.md')
})

test('target_filename: non-md extension unchanged', () => {
	assert.strictEqual(target_filename('template.html'), 'template.html')
})

test('target_filename: no extension unchanged', () => {
	assert.strictEqual(target_filename('LICENSE'), 'LICENSE')
})
