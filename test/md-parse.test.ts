// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {make_fence_tracker} from '../src/md-parse.ts'

// * make_fence_tracker

// ** feed return values

test('make_fence_tracker: feed returns false for plain content', () => {
	const fence = make_fence_tracker()
	assert.strictEqual(fence.feed('plain text', 0), false)
	assert.strictEqual(fence.feed('# heading', 1), false)
	assert.strictEqual(fence.feed('', 2), false)
})

test('make_fence_tracker: feed returns true for opener, body, and closer (backticks)', () => {
	const fence = make_fence_tracker()
	assert.strictEqual(fence.feed('```', 0), true)
	assert.strictEqual(fence.feed('body', 1), true)
	assert.strictEqual(fence.feed('```', 2), true)
})

test('make_fence_tracker: feed returns true for opener, body, and closer (tildes)', () => {
	const fence = make_fence_tracker()
	assert.strictEqual(fence.feed('~~~', 0), true)
	assert.strictEqual(fence.feed('body', 1), true)
	assert.strictEqual(fence.feed('~~~', 2), true)
})

// ** fence opener/closer matching

test('make_fence_tracker: opens and closes with 3 backticks', () => {
	const fence = make_fence_tracker()
	fence.feed('```', 0)
	assert.strictEqual(fence.is_open, true)
	assert.strictEqual(fence.unclosed_line, 0)
	fence.feed('```', 1)
	assert.strictEqual(fence.is_open, false)
	assert.strictEqual(fence.unclosed_line, null)
})

test('make_fence_tracker: opens and closes with 3 tildes', () => {
	const fence = make_fence_tracker()
	fence.feed('~~~', 0)
	assert.strictEqual(fence.is_open, true)
	assert.strictEqual(fence.unclosed_line, 0)
	fence.feed('~~~', 1)
	assert.strictEqual(fence.is_open, false)
	assert.strictEqual(fence.unclosed_line, null)
})

test('make_fence_tracker: 4-backtick opener closes with 4 backticks', () => {
	const fence = make_fence_tracker()
	fence.feed('````', 0)
	fence.feed('````', 1)
	assert.strictEqual(fence.is_open, false)
	assert.strictEqual(fence.unclosed_line, null)
})

test('make_fence_tracker: 4-backtick opener is NOT closed by 3 backticks (length check)', () => {
	const fence = make_fence_tracker()
	fence.feed('````', 0)
	fence.feed('```', 1)
	assert.strictEqual(fence.is_open, true)
	assert.strictEqual(fence.unclosed_line, 0)
})

test('make_fence_tracker: 3-backtick opener closes with 12 backticks (length ≥ opener)', () => {
	const fence = make_fence_tracker()
	fence.feed('```', 0)
	fence.feed('````````````', 1)
	assert.strictEqual(fence.is_open, false)
	assert.strictEqual(fence.unclosed_line, null)
})

test('make_fence_tracker: backtick opener is NOT closed by tildes (char check)', () => {
	const fence = make_fence_tracker()
	fence.feed('```', 0)
	fence.feed('~~~', 1)
	assert.strictEqual(fence.is_open, true)
	assert.strictEqual(fence.unclosed_line, 0)
})

test('make_fence_tracker: fence opener with language tag opens', () => {
	const fence = make_fence_tracker()
	assert.strictEqual(fence.feed('```typescript', 0), true)
	assert.strictEqual(fence.is_open, true)
})

test('make_fence_tracker: closing a fence opener with language tag', () => {
	const fence = make_fence_tracker()
	assert.strictEqual(fence.feed('```typescript', 0), true)
	assert.strictEqual(fence.feed('```', 1), true)
	assert.strictEqual(fence.is_open, false)
	assert.strictEqual(fence.unclosed_line, null)
})

test('make_fence_tracker: closing a tilde fence opener with language tag with more tildes', () => {
	const fence = make_fence_tracker()
	fence.feed('~~~typescript', 0)
	assert.strictEqual(fence.is_open, true)
	assert.strictEqual(fence.unclosed_line, 0)
	assert.strictEqual(fence.feed('~~~~~~~~~~~~~', 1), true)
	assert.strictEqual(fence.is_open, false)
	assert.strictEqual(fence.unclosed_line, null)
})

// ** unclosed_line

test('make_fence_tracker: unclosed_line is null on empty input', () => {
	const fence = make_fence_tracker()
	assert.strictEqual(fence.unclosed_line, null)
	assert.strictEqual(fence.is_open, false)
})

test('make_fence_tracker: unclosed_line reports opener line when left open', () => {
	const fence = make_fence_tracker()
	fence.feed('plain', 0)
	fence.feed('```', 1)
	fence.feed('body', 2)
	assert.strictEqual(fence.unclosed_line, 1)
	assert.strictEqual(fence.is_open, true)
})

test('make_fence_tracker: multiple fences all closed → unclosed_line is null', () => {
	const fence = make_fence_tracker()
	fence.feed('```', 0)
	fence.feed('```', 1)
	fence.feed('plain', 2)
	fence.feed('~~~', 3)
	fence.feed('~~~', 4)
	assert.strictEqual(fence.unclosed_line, null)
	assert.strictEqual(fence.is_open, false)
})

test('make_fence_tracker: multiple fences, last one unclosed → unclosed_line is last opener', () => {
	const fence = make_fence_tracker()
	fence.feed('```', 0)
	fence.feed('```', 1)
	fence.feed('plain', 2)
	fence.feed('```', 3)
	fence.feed('body', 4)
	assert.strictEqual(fence.unclosed_line, 3)
	assert.strictEqual(fence.is_open, true)
})
