// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {strip_html_comments} from '../src/strip-html-comments.ts'

// * strip_html_comments — content

test('strip_html_comments: empty input unchanged', () => {
	assert.strictEqual(strip_html_comments('').content, '')
})

test('strip_html_comments: no comments → unchanged', () => {
	const input = [
		'# Heading',
		'',
		'Some text.',
		'',
	].join('\n')
	assert.strictEqual(strip_html_comments(input).content, input)
})

test('strip_html_comments: inline comment removed', () => {
	assert.strictEqual(
		strip_html_comments([
			'before <!-- note --> after',
			'',
		].join('\n')).content,
		[
			'before  after',
			'',
		].join('\n'),
	)
})

test('strip_html_comments: full-line comment dropped', () => {
	assert.strictEqual(
		strip_html_comments([
			'line one',
			'<!-- comment -->',
			'line two',
			'',
		].join('\n')).content,
		[
			'line one',
			'line two',
			'',
		].join('\n'),
	)
})

test('strip_html_comments: comment between blank lines collapses to one blank line', () => {
	assert.strictEqual(
		strip_html_comments([
			'line one',
			'',
			'<!-- comment -->',
			'',
			'line two',
			'',
		].join('\n')).content,
		[
			'line one',
			'',
			'line two',
			'',
		].join('\n'),
	)
})

test('strip_html_comments: multiple blank lines before comment are preserved', () => {
	assert.strictEqual(
		strip_html_comments([
			'line one',
			'',
			'',
			'<!-- comment -->',
			'',
			'line two',
			'',
		].join('\n')).content,
		[
			'line one',
			'',
			'',
			'line two',
			'',
		].join('\n'),
	)
})

test('strip_html_comments: multiline comment dropped', () => {
	assert.strictEqual(
		strip_html_comments([
			'before',
			'<!-- start',
			'middle',
			'end -->',
			'after',
			'',
		].join('\n')).content,
		[
			'before',
			'after',
			'',
		].join('\n'),
	)
})

test('strip_html_comments: comment inside fenced code block preserved', () => {
	const input = [
		'```',
		'<!-- not stripped -->',
		'```',
		'',
	].join('\n')
	assert.strictEqual(strip_html_comments(input).content, input)
})

test('strip_html_comments: comment inside tilde-fenced block preserved', () => {
	const input = [
		'~~~',
		'<!-- not stripped -->',
		'~~~',
		'',
	].join('\n')
	assert.strictEqual(strip_html_comments(input).content, input)
})

test('strip_html_comments: multiline comment inside fenced block preserved', () => {
	const input = [
		'```',
		'<!-- not',
		'stripped -->',
		'```',
		'',
	].join('\n')
	assert.strictEqual(strip_html_comments(input).content, input)
})

test('strip_html_comments: multiple comments on one line', () => {
	assert.strictEqual(
		strip_html_comments([
			'a <!-- x --> b <!-- y --> c',
			'',
		].join('\n')).content,
		[
			'a  b  c',
			'',
		].join('\n'),
	)
})

test('strip_html_comments: comment starts mid-line, spans multiple lines, text follows closing', () => {
	assert.strictEqual(
		strip_html_comments([
			'a <!-- x',
			'y',
			'z --> b',
			'c',
			'',
		].join('\n')).content,
		[
			'a ',
			' b',
			'c',
			'',
		].join('\n'),
	)
})

// * strip_html_comments — line_map

test('strip_html_comments: empty input → line_map with one entry for the single empty line', () => {
	assert.deepStrictEqual(strip_html_comments('').line_map, [0])
})

test('strip_html_comments: no comments → identity line_map', () => {
	const {line_map} = strip_html_comments(['a', 'b', 'c'].join('\n'))
	assert.deepStrictEqual(line_map, [0, 1, 2])
})

test('strip_html_comments: full-line comment dropped → line_map skips it', () => {
	// source: line 0 "line one", line 1 "<!-- comment -->", line 2 "line two", line 3 ""
	const {line_map} = strip_html_comments([
		'line one',
		'<!-- comment -->',
		'line two',
		'',
	].join('\n'))
	assert.deepStrictEqual(line_map, [0, 2, 3])
})

test('strip_html_comments: multiline comment → line_map skips all dropped lines', () => {
	// source: 0 "before", 1 "<!-- start", 2 "middle", 3 "end -->", 4 "after", 5 ""
	const {line_map} = strip_html_comments([
		'before',
		'<!-- start',
		'middle',
		'end -->',
		'after',
		'',
	].join('\n'))
	assert.deepStrictEqual(line_map, [0, 4, 5])
})

test('strip_html_comments: blank-line collapse → collapsed blank not in line_map', () => {
	// source: 0 "line one", 1 "", 2 "<!-- comment -->", 3 "", 4 "line two", 5 ""
	// line 2 dropped (comment), line 3 suppressed (blank collapse)
	const {line_map} = strip_html_comments([
		'line one',
		'',
		'<!-- comment -->',
		'',
		'line two',
		'',
	].join('\n'))
	assert.deepStrictEqual(line_map, [0, 1, 4, 5])
})

test('strip_html_comments: inline comment on preserved line → correct source index', () => {
	// source: 0 "before <!-- note --> after", 1 ""
	const {line_map} = strip_html_comments([
		'before <!-- note --> after',
		'',
	].join('\n'))
	assert.deepStrictEqual(line_map, [0, 1])
})

test('strip_html_comments: fenced block lines → correct source indices', () => {
	// source: 0 "```", 1 "<!-- not stripped -->", 2 "```", 3 ""
	const {line_map} = strip_html_comments([
		'```',
		'<!-- not stripped -->',
		'```',
		'',
	].join('\n'))
	assert.deepStrictEqual(line_map, [0, 1, 2, 3])
})

test('strip_html_comments: comment spans lines, text before and after → correct source indices', () => {
	// source: 0 "a <!-- x", 1 "y", 2 "z --> b", 3 "c", 4 ""
	// output: "a " (src 0), " b" (src 2), "c" (src 3), "" (src 4)
	const {line_map} = strip_html_comments([
		'a <!-- x',
		'y',
		'z --> b',
		'c',
		'',
	].join('\n'))
	assert.deepStrictEqual(line_map, [0, 2, 3, 4])
})

// * strip_html_comments — unclosed_comment_line

test('strip_html_comments: no unclosed comment → unclosed_comment_line is null', () => {
	assert.strictEqual(strip_html_comments('hello\n').unclosed_comment_line, null)
})

test('strip_html_comments: all comments closed → unclosed_comment_line is null', () => {
	const {unclosed_comment_line} = strip_html_comments([
		'before',
		'<!-- comment -->',
		'after',
	].join('\n'))
	assert.strictEqual(unclosed_comment_line, null)
})

test('strip_html_comments: multiline closed comment → unclosed_comment_line is null', () => {
	const {unclosed_comment_line} = strip_html_comments([
		'before',
		'<!-- start',
		'middle',
		'end -->',
		'after',
	].join('\n'))
	assert.strictEqual(unclosed_comment_line, null)
})

test('strip_html_comments: multiline closed comment with text on open/close lines → unclosed_comment_line is null', () => {
	const {unclosed_comment_line} = strip_html_comments([
		'a <!-- start',
		'middle',
		'end --> b',
		'after',
	].join('\n'))
	assert.strictEqual(unclosed_comment_line, null)
})

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
	const {unclosed_comment_line} = strip_html_comments('a <!-- b\nc\n')
	assert.strictEqual(unclosed_comment_line, 0)
})
