// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {validate_manifest} from '../src/manifest.ts'

// * validate_manifest

test('validate_manifest: passes when all target_names are unique', () => {
	const manifest = [
		{source_name: 'SKILL.md', target_name: 'SKILL.md', source_content: '', target_content: ''},
		{source_name: 'extra.txt', target_name: 'extra.txt', source_content: Buffer.alloc(0), target_content: Buffer.alloc(0)},
	]

	assert.doesNotThrow(() => validate_manifest(manifest))
})

test('validate_manifest: throws listing all conflicting source names', () => {
	const manifest = [
		{source_name: 'SKILL.source.md', target_name: 'SKILL.md', source_content: '', target_content: ''},
		{source_name: 'SKILL.md', target_name: 'SKILL.md', source_content: '', target_content: ''},
	]

	assert.throws(() => validate_manifest(manifest), new Error('Conflicting files: SKILL.source.md, SKILL.md'))
})

test('validate_manifest: throws when no SKILL.md target present', () => {
	const manifest = [
		{source_name: 'extra.md', target_name: 'extra.md', source_content: '', target_content: ''},
	]

	assert.throws(() => validate_manifest(manifest), new Error('No entry targets SKILL.md'))
})

test('validate_manifest: throws on empty manifest', () => {
	assert.throws(() => validate_manifest([]), new Error('No entry targets SKILL.md'))
})
