// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {
	HEADING_RE,
	classify_lines,
	is_section_empty,
	make_fence_tracker,
	type LineKind,
} from '../src/md-parse.ts'

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

// * HEADING_RE

// ** Matches

test('HEADING_RE: `# Title` → level 1, text "Title"', () => {
	const m = '# Title'.match(HEADING_RE)
	assert.ok(m)
	assert.strictEqual(m[1].length, 1)
	assert.strictEqual(m[2], 'Title')
})

test('HEADING_RE: `###### Six` → level 6', () => {
	const m = '###### Six'.match(HEADING_RE)
	assert.ok(m)
	assert.strictEqual(m[1].length, 6)
	assert.strictEqual(m[2], 'Six')
})

test('HEADING_RE: bare `#` matches with no title (group 2 undefined)', () => {
	const m = '#'.match(HEADING_RE)
	assert.ok(m)
	assert.strictEqual(m[1].length, 1)
	assert.strictEqual(m[2], undefined)
})

test('HEADING_RE: `# ` matches with empty title', () => {
	const m = '# '.match(HEADING_RE)
	assert.ok(m)
	assert.strictEqual(m[1].length, 1)
	assert.strictEqual(m[2], '')
})

test('HEADING_RE: strips CommonMark trailing-`#` closing sequence from title', () => {
	const m = '# Title ###'.match(HEADING_RE)
	assert.ok(m)
	assert.strictEqual(m[2], 'Title')
})

test('HEADING_RE: trailing-`#` closing sequence of arbitrary length is stripped', () => {
	const m = '## Foo #####'.match(HEADING_RE)
	assert.ok(m)
	assert.strictEqual(m[1].length, 2)
	assert.strictEqual(m[2], 'Foo')
})

test('HEADING_RE: trailing `#` WITHOUT preceding whitespace is part of title', () => {
	// CommonMark: closing sequence must be preceded by whitespace.
	const m = '# Title#'.match(HEADING_RE)
	assert.ok(m)
	assert.strictEqual(m[2], 'Title#')
})

test('HEADING_RE: trailing whitespace stripped from title', () => {
	const m = '# Title   '.match(HEADING_RE)
	assert.ok(m)
	assert.strictEqual(m[2], 'Title')
})

test('HEADING_RE: multi-word title preserved', () => {
	const m = '# A great title'.match(HEADING_RE)
	assert.ok(m)
	assert.strictEqual(m[2], 'A great title')
})

test('HEADING_RE: allows 0, 1, 2, and 3 leading spaces', () => {
	for (const indent of ['', ' ', '  ', '   ']) {
		const m = `${indent}# Title`.match(HEADING_RE)
		assert.ok(m, `expected match for indent=${JSON.stringify(indent)}`)
		assert.strictEqual(m[1].length, 1)
		assert.strictEqual(m[2], 'Title')
	}
})

// ** Non-matches

test('HEADING_RE: `#hashtag` (no whitespace after hashes) does not match', () => {
	assert.strictEqual('#hashtag'.match(HEADING_RE), null)
})

test('HEADING_RE: 7+ hashes does not match', () => {
	assert.strictEqual('####### Seven'.match(HEADING_RE), null)
})

test('HEADING_RE: 4-space indent does not match (indented code block per CommonMark)', () => {
	assert.strictEqual('    # Title'.match(HEADING_RE), null)
})

// * classify_lines

test('classify_lines: blank line → blank', () => {
	assert.deepStrictEqual(classify_lines(['']), [{kind: 'blank'}])
})

test('classify_lines: ordinary text → content', () => {
	assert.deepStrictEqual(classify_lines(['some text']), [{kind: 'content'}])
})

test('classify_lines: heading preserves level and title', () => {
	assert.deepStrictEqual(
		classify_lines(['## My Heading']),
		[{kind: 'heading', level: 2, text: 'My Heading'}],
	)
})

test('classify_lines: bare `#` → heading with empty text', () => {
	assert.deepStrictEqual(classify_lines(['#']), [{kind: 'heading', level: 1, text: ''}])
})

test('classify_lines: `# ` (hash + space) → heading with empty text', () => {
	assert.deepStrictEqual(classify_lines(['# ']), [{kind: 'heading', level: 1, text: ''}])
})

test('classify_lines: trailing-`#` closing sequence stripped from heading text', () => {
	assert.deepStrictEqual(
		classify_lines(['## Foo ##']),
		[{kind: 'heading', level: 2, text: 'Foo'}],
	)
})

test('classify_lines: fence opener, body, and closer all classified as content', () => {
	const lines = [
		'```',
		'body',
		'```',
	]
	assert.deepStrictEqual(classify_lines(lines), [
		{kind: 'content'},
		{kind: 'content'},
		{kind: 'content'},
	])
})

test('classify_lines: `#` inside a backtick fence is content, not heading', () => {
	const lines = [
		'```',
		'# fake',
		'```',
	]
	assert.deepStrictEqual(classify_lines(lines), [
		{kind: 'content'},
		{kind: 'content'},
		{kind: 'content'},
	])
})

test('classify_lines: `#` inside a tilde fence is content, not heading', () => {
	const lines = [
		'~~~',
		'# fake',
		'~~~',
	]
	assert.deepStrictEqual(classify_lines(lines), [
		{kind: 'content'},
		{kind: 'content'},
		{kind: 'content'},
	])
})

test('classify_lines: blank line inside a fence is content (not blank)', () => {
	const lines = [
		'```',
		'',
		'```',
	]
	assert.deepStrictEqual(classify_lines(lines), [
		{kind: 'content'},
		{kind: 'content'},
		{kind: 'content'},
	])
})

test('classify_lines: real headings outside, pseudo-heading inside fence', () => {
	const lines = [
		'# H1',
		'```',
		'# fake',
		'```',
		'# H2',
	]
	assert.deepStrictEqual(classify_lines(lines), [
		{kind: 'heading', level: 1, text: 'H1'},
		{kind: 'content'},
		{kind: 'content'},
		{kind: 'content'},
		{kind: 'heading', level: 1, text: 'H2'},
	])
})

// * is_section_empty

test('is_section_empty: heading at EOF is empty', () => {
	const kinds: LineKind[] = [{kind: 'heading', level: 1, text: 'A'}]
	assert.strictEqual(is_section_empty(kinds, 0, 1), true)
})

test('is_section_empty: heading followed only by blank lines is empty', () => {
	const kinds: LineKind[] = [
		{kind: 'heading', level: 1, text: 'A'},
		{kind: 'blank'},
		{kind: 'blank'},
	]
	assert.strictEqual(is_section_empty(kinds, 0, 1), true)
})

test('is_section_empty: blank then same-level heading is empty', () => {
	const kinds: LineKind[] = [
		{kind: 'heading', level: 2, text: 'A'},
		{kind: 'blank'},
		{kind: 'heading', level: 2, text: 'B'},
		{kind: 'content'},
	]
	assert.strictEqual(is_section_empty(kinds, 0, 2), true)
})

test('is_section_empty: blank then higher-level heading is empty', () => {
	const kinds: LineKind[] = [
		{kind: 'heading', level: 2, text: 'A'},
		{kind: 'blank'},
		{kind: 'heading', level: 1, text: 'B'},
		{kind: 'content'},
	]
	assert.strictEqual(is_section_empty(kinds, 0, 2), true)
})

test('is_section_empty: blank then deeper heading (subsection) is NOT empty', () => {
	const kinds: LineKind[] = [
		{kind: 'heading', level: 1, text: 'A'},
		{kind: 'blank'},
		{kind: 'heading', level: 2, text: 'B'},
		{kind: 'content'},
	]
	assert.strictEqual(is_section_empty(kinds, 0, 1), false)
})

test('is_section_empty: content immediately after heading is NOT empty', () => {
	const kinds: LineKind[] = [
		{kind: 'heading', level: 1, text: 'A'},
		{kind: 'content'},
	]
	assert.strictEqual(is_section_empty(kinds, 0, 1), false)
})

test('is_section_empty: blank then content is NOT empty', () => {
	const kinds: LineKind[] = [
		{kind: 'heading', level: 1, text: 'A'},
		{kind: 'blank'},
		{kind: 'content'},
	]
	assert.strictEqual(is_section_empty(kinds, 0, 1), false)
})
