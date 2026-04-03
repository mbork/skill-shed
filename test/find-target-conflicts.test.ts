// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {find_target_conflicts} from '../src/manifest.ts'

// * find_target_conflicts

test('find_target_conflicts: returns empty array when no conflicts', () => {
	assert.deepStrictEqual(find_target_conflicts(['SKILL.md', 'extra.txt']), [])
})

test('find_target_conflicts: returns conflicting group', () => {
	const result = find_target_conflicts(['SKILL.md', 'SKILL.source.md'])

	assert.strictEqual(result.length, 1)
	assert.deepStrictEqual(result[0], ['SKILL.md', 'SKILL.source.md'])
})

test('find_target_conflicts: returns multiple conflicting groups', () => {
	const result = find_target_conflicts(['SKILL.source.md', 'SKILL.md', 'extra.source.md', 'extra.md'])

	assert.strictEqual(result.length, 2)
})

test('find_target_conflicts: returns empty array for empty input', () => {
	assert.deepStrictEqual(find_target_conflicts([]), [])
})
