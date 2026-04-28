// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {strip_html_comments} from '../src/strip-html-comments.ts'

// * strip_html_comments

test('strip_html_comments: empty input unchanged', () => {
	assert.deepStrictEqual(strip_html_comments(''), {
		content: '',
		line_map: [0],
		unclosed_comment_line: null,
		unclosed_fence_line: null,
	})
})

test('strip_html_comments: no comments → unchanged', () => {
	const input = [
		'# Heading',
		'',
		'Some text.',
		'',
	].join('\n')
	assert.deepStrictEqual(strip_html_comments(input), {
		content: input,
		line_map: [0, 1, 2, 3],
		unclosed_comment_line: null,
		unclosed_fence_line: null,
	})
})

test('strip_html_comments: no trailing newline → unchanged', () => {
	assert.deepStrictEqual(strip_html_comments('a\nb'), {
		content: 'a\nb',
		line_map: [0, 1],
		unclosed_comment_line: null,
		unclosed_fence_line: null,
	})
})

test('strip_html_comments: inline comment removed', () => {
	assert.deepStrictEqual(
		strip_html_comments([
			'before <!-- note --> after',
			'',
		].join('\n')),
		{
			content: [
				'before  after',
				'',
			].join('\n'),
			line_map: [0, 1],
			unclosed_comment_line: null,
			unclosed_fence_line: null,
		},
	)
})

test('strip_html_comments: full-line comment dropped', () => {
	assert.deepStrictEqual(
		strip_html_comments([
			'line one',
			'<!-- comment -->',
			'line two',
			'',
		].join('\n')),
		{
			content: [
				'line one',
				'line two',
				'',
			].join('\n'),
			// source line 1 (comment) dropped
			line_map: [0, 2, 3],
			unclosed_comment_line: null,
			unclosed_fence_line: null,
		},
	)
})

test('strip_html_comments: comment between blank lines collapses to one blank line', () => {
	assert.deepStrictEqual(
		strip_html_comments([
			'line one',
			'',
			'<!-- comment -->',
			'',
			'line two',
			'',
		].join('\n')),
		{
			content: [
				'line one',
				'',
				'line two',
				'',
			].join('\n'),
			// source line 2 dropped (comment), source line 3 suppressed (blank collapse)
			line_map: [0, 1, 4, 5],
			unclosed_comment_line: null,
			unclosed_fence_line: null,
		},
	)
})

test('strip_html_comments: one blank line before comment, multiple after — first after collapses', () => {
	assert.deepStrictEqual(
		strip_html_comments([
			'line one',
			'',
			'<!-- comment -->',
			'',
			'',
			'line two',
			'',
		].join('\n')),
		{
			content: [
				'line one',
				'',
				'',
				'line two',
				'',
			].join('\n'),
			// source line 2 dropped (comment), source line 3 suppressed (blank collapse);
			// source line 4 passes through (was_comment_stripped already reset)
			line_map: [0, 1, 4, 5, 6],
			unclosed_comment_line: null,
			unclosed_fence_line: null,
		},
	)
})

test('strip_html_comments: multiple blank lines before comment are preserved', () => {
	assert.deepStrictEqual(
		strip_html_comments([
			'line one',
			'',
			'',
			'<!-- comment -->',
			'',
			'line two',
			'',
		].join('\n')),
		{
			content: [
				'line one',
				'',
				'',
				'line two',
				'',
			].join('\n'),
			// source line 3 dropped (comment), source line 4 suppressed (blank collapse after two blanks)
			line_map: [0, 1, 2, 5, 6],
			unclosed_comment_line: null,
			unclosed_fence_line: null,
		},
	)
})

test('strip_html_comments: multiline comment dropped', () => {
	assert.deepStrictEqual(
		strip_html_comments([
			'before',
			'<!-- start',
			'middle',
			'end -->',
			'after',
			'',
		].join('\n')),
		{
			content: [
				'before',
				'after',
				'',
			].join('\n'),
			// source lines 1–3 all dropped
			line_map: [0, 4, 5],
			unclosed_comment_line: null,
			unclosed_fence_line: null,
		},
	)
})

test('strip_html_comments: comment starts mid-line, spans multiple lines, text follows closing', () => {
	assert.deepStrictEqual(
		strip_html_comments([
			'a <!-- x',
			'y',
			'z --> b',
			'c',
			'',
		].join('\n')),
		{
			content: [
				'a ',
				' b',
				'c',
				'',
			].join('\n'),
			// source line 1 dropped; source lines 0, 2, 3, 4 kept
			line_map: [0, 2, 3, 4],
			unclosed_comment_line: null,
			unclosed_fence_line: null,
		},
	)
})

test('strip_html_comments: multiple comments on one line', () => {
	assert.deepStrictEqual(
		strip_html_comments([
			'a <!-- x --> b <!-- y --> c',
			'',
		].join('\n')),
		{
			content: [
				'a  b  c',
				'',
			].join('\n'),
			line_map: [0, 1],
			unclosed_comment_line: null,
			unclosed_fence_line: null,
		},
	)
})

test('strip_html_comments: --> without preceding <!-- is left as-is', () => {
	const input = [
		'line with --> arrow',
		'next',
		'',
	].join('\n')
	assert.deepStrictEqual(strip_html_comments(input), {
		content: input,
		line_map: [0, 1, 2],
		unclosed_comment_line: null,
		unclosed_fence_line: null,
	})
})

test('strip_html_comments: nested-looking comments — HTML does not nest', () => {
	// First --> closes the comment; second --> is left as literal text
	assert.deepStrictEqual(
		strip_html_comments([
			'<!-- outer <!-- inner --> text after -->',
			'',
		].join('\n')),
		{
			content: [
				' text after -->',
				'',
			].join('\n'),
			line_map: [0, 1],
			unclosed_comment_line: null,
			unclosed_fence_line: null,
		},
	)
})

test('strip_html_comments: comment inside fenced code block preserved', () => {
	const input = [
		'```',
		'<!-- not stripped -->',
		'```',
		'',
	].join('\n')
	assert.deepStrictEqual(strip_html_comments(input), {
		content: input,
		line_map: [0, 1, 2, 3],
		unclosed_comment_line: null,
		unclosed_fence_line: null,
	})
})

test('strip_html_comments: comment inside tilde-fenced block preserved', () => {
	const input = [
		'~~~',
		'<!-- not stripped -->',
		'~~~',
		'',
	].join('\n')
	assert.deepStrictEqual(strip_html_comments(input), {
		content: input,
		line_map: [0, 1, 2, 3],
		unclosed_comment_line: null,
		unclosed_fence_line: null,
	})
})

test('strip_html_comments: multiline comment inside fenced block preserved', () => {
	const input = [
		'```',
		'<!-- not',
		'stripped -->',
		'```',
		'',
	].join('\n')
	assert.deepStrictEqual(strip_html_comments(input), {
		content: input,
		line_map: [0, 1, 2, 3, 4],
		unclosed_comment_line: null,
		unclosed_fence_line: null,
	})
})

test('strip_html_comments: fence opener with info string', () => {
	const input = [
		'```js',
		'<!-- preserved -->',
		'```',
		'',
	].join('\n')
	assert.deepStrictEqual(strip_html_comments(input), {
		content: input,
		line_map: [0, 1, 2, 3],
		unclosed_comment_line: null,
		unclosed_fence_line: null,
	})
})

test('strip_html_comments: longer fence not closed by shorter fence', () => {
	// 4-tick opener; inner 3-tick line does not close it
	const input = [
		'````',
		'```',
		'<!-- preserved -->',
		'````',
		'',
	].join('\n')
	assert.deepStrictEqual(strip_html_comments(input), {
		content: input,
		line_map: [0, 1, 2, 3, 4],
		unclosed_comment_line: null,
		unclosed_fence_line: null,
	})
})

test('strip_html_comments: unclosed fence — all lines pass through including <!--', () => {
	// Fence opened with ``` but never closed; everything treated as fenced content
	const input = [
		'```',
		'<!-- not stripped -->',
		'plain text',
		'',
	].join('\n')
	assert.deepStrictEqual(strip_html_comments(input), {
		content: input,
		line_map: [0, 1, 2, 3],
		unclosed_comment_line: null,
		unclosed_fence_line: 0,
	})
})

test('strip_html_comments: unclosed <!-- inside fenced block → unclosed_comment_line is null', () => {
	// Fence takes precedence; <!-- is never processed as HTML
	const input = [
		'```',
		'<!-- unclosed',
		'```',
		'',
	].join('\n')
	assert.deepStrictEqual(strip_html_comments(input), {
		content: input,
		line_map: [0, 1, 2, 3],
		unclosed_comment_line: null,
		unclosed_fence_line: null,
	})
})

test('strip_html_comments: nested-looking multiline comments — inner --> closes the outer <!--', () => {
	assert.deepStrictEqual(
		strip_html_comments([
			'before',
			'<!-- open',
			'<!-- still open',
			'inner end -->',
			'outer end -->',
			'after',
			'',
		].join('\n')),
		{
			content: [
				'before',
				'outer end -->',
				'after',
				'',
			].join('\n'),
			// source lines 1–3 dropped; source line 4 is now plain text (comment already closed)
			line_map: [0, 4, 5, 6],
			unclosed_comment_line: null,
			unclosed_fence_line: null,
		},
	)
})

test('strip_html_comments: fence opener inside a multi-line comment is stripped, not treated as a fence', () => {
	// `\`\`\`` inside an open <!-- ... --> block is comment content, not a fence opener.
	// Without this rule, the "fence" would never close and the rest of the file would
	// leak through unstripped.
	assert.deepStrictEqual(
		strip_html_comments([
			'before',
			'<!--',
			'```',
			'-->',
			'after',
			'',
		].join('\n')),
		{
			content: [
				'before',
				'after',
				'',
			].join('\n'),
			line_map: [0, 4, 5],
			unclosed_comment_line: null,
			unclosed_fence_line: null,
		},
	)
})

test('strip_html_comments: unclosed <!-- in unclosed fence → fence wins, unclosed_comment_line is null', () => {
	// Fence takes full precedence; <!-- is never processed even though fence never closes
	const input = [
		'```',
		'<!-- unclosed',
		'still in fence',
		'',
	].join('\n')
	assert.deepStrictEqual(strip_html_comments(input), {
		content: input,
		line_map: [0, 1, 2, 3],
		unclosed_comment_line: null,
		unclosed_fence_line: 0,
	})
})

// ** unclosed_comment_line
// The null case is covered by every test above (all assert deepStrictEqual on the full result).

test('strip_html_comments: unclosed comment → unclosed_comment_line is source line of <!--', () => {
	// <!-- opens on line 1 (0-based), never closes
	const {unclosed_comment_line} = strip_html_comments([
		'text',
		'<!-- unclosed',
		'still inside',
	].join('\n'))
	assert.strictEqual(unclosed_comment_line, 1)
})

test('strip_html_comments: unclosed comment mid-line → reports that source line', () => {
	// <!-- opens mid-line 0, never closes
	assert.strictEqual(strip_html_comments('a <!-- b\nc\n').unclosed_comment_line, 0)
})
