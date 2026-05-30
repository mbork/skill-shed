// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {is_file_referenced} from '../src/lint.ts'

// * is_file_referenced

test('is_file_referenced: matches a standalone filename in prose', () => {
	assert.strictEqual(is_file_referenced('guide.md', 'See guide.md for details.'), true)
})

test('is_file_referenced: matches at the start of the content', () => {
	assert.strictEqual(is_file_referenced('guide.md', 'guide.md is the entry point.'), true)
})

test('is_file_referenced: matches at the very end of the content', () => {
	assert.strictEqual(is_file_referenced('guide.md', 'Read guide.md'), true)
})

test('is_file_referenced: matches when the filename ends a sentence (trailing period)', () => {
	assert.strictEqual(is_file_referenced('guide.md', 'Start with guide.md.'), true)
})

test('is_file_referenced: returns false when the filename is absent', () => {
	assert.strictEqual(is_file_referenced('guide.md', 'No references here.'), false)
})

test('is_file_referenced: does not match a longer filename it is a suffix of', () => {
	assert.strictEqual(is_file_referenced('data.md', 'See metadata.md.'), false)
})

test('is_file_referenced: does not match a longer filename it is a prefix of', () => {
	assert.strictEqual(is_file_referenced('guide.md', 'See guide.mdx.'), false)
})

test('is_file_referenced: does not match when flanked by a hyphen', () => {
	assert.strictEqual(is_file_referenced('guide.md', 'See old-guide.md here.'), false)
})

test('is_file_referenced: escapes regex metacharacters in the filename', () => {
	assert.strictEqual(is_file_referenced('a+b.md', 'See a+b.md here.'), true)
	assert.strictEqual(is_file_referenced('a+b.md', 'See axb.md here.'), false)
})

// ** Trailing-period boundary (allow sentence-ending `.`, reject filename-joining `.`)

test('is_file_referenced: does not match when a different extension follows (double extension)', () => {
	// `guide.md.bak` names a different file; the `.` after `guide.md` joins more filename, so
	// `guide.md` must NOT be considered referenced.
	assert.strictEqual(is_file_referenced('guide.md', 'edit guide.md.bak now'), false)
})

test('is_file_referenced: does not match when a dot precedes the name (tightened lookbehind)', () => {
	// `v2.guide.md` is one filename; a `.` immediately before `guide.md` means it is a suffix
	// of a longer name, not a standalone reference.
	assert.strictEqual(is_file_referenced('guide.md', 'see v2.guide.md here'), false)
})

test('is_file_referenced: matches when wrapped in closing punctuation', () => {
	assert.strictEqual(is_file_referenced('guide.md', 'see (guide.md) for more'), true)
})

test('is_file_referenced: matches when the name is followed by an ellipsis', () => {
	// A run of trailing dots (ellipsis) is sentence punctuation, not filename structure, so
	// the reference still counts.
	assert.strictEqual(is_file_referenced('guide.md', 'maybe guide.md... maybe not'), true)
})

test('is_file_referenced: does not match when a dot-run is followed by more filename', () => {
	// Guards the `\.*` choice: a run of dots that resolves into more filename chars
	// (`guide.md...bak`) is still structural, not punctuation, so it must NOT count.
	assert.strictEqual(is_file_referenced('guide.md', 'edit guide.md...bak now'), false)
})

test('is_file_referenced: does not match when a hyphen follows the name', () => {
	// Symmetric to the leading-hyphen case: a `-` directly after the name joins more
	// filename (`guide.md-old`), so it is not a standalone reference.
	assert.strictEqual(is_file_referenced('guide.md', 'see guide.md-old here'), false)
})
