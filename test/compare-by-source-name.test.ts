// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {compare_by_source_name} from '../src/manifest.ts'

// * compare_by_source_name
// Direct unit test of the comparator.  Indirect coverage via .toSorted() in the git builders
// only exercises one branch (V8 sorts already-sorted git output by calling the comparator in
// a single direction) and never exercises the equal-case branch (git listings have no
// duplicate paths).  These three assertions cover all three branches.

test('compare_by_source_name: a < b returns -1', () => {
	assert.strictEqual(
		compare_by_source_name({source_name: 'a'}, {source_name: 'b'}),
		-1,
	)
})

test('compare_by_source_name: a > b returns 1', () => {
	assert.strictEqual(
		compare_by_source_name({source_name: 'b'}, {source_name: 'a'}),
		1,
	)
})

test('compare_by_source_name: a === b returns 0', () => {
	assert.strictEqual(
		compare_by_source_name({source_name: 'x'}, {source_name: 'x'}),
		0,
	)
})
