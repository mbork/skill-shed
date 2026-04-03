// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {strip_html_comments} from '../src/strip-html-comments.ts'

// * strip_html_comments

test('strip_html_comments: empty input unchanged', () => {
	assert.strictEqual(strip_html_comments(''), '')
})

test('strip_html_comments: no comments → unchanged', () => {
	const input = [
		'# Heading',
		'',
		'Some text.',
		'',
	].join('\n')
	assert.strictEqual(strip_html_comments(input), input)
})

test('strip_html_comments: inline comment removed', () => {
	assert.strictEqual(
		strip_html_comments([
			'before <!-- note --> after',
			'',
		].join('\n')),
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
		].join('\n')),
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
		].join('\n')),
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
		].join('\n')),
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
		].join('\n')),
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
	assert.strictEqual(strip_html_comments(input), input)
})

test('strip_html_comments: comment inside tilde-fenced block preserved', () => {
	const input = [
		'~~~',
		'<!-- not stripped -->',
		'~~~',
		'',
	].join('\n')
	assert.strictEqual(strip_html_comments(input), input)
})

test('strip_html_comments: multiline comment inside fenced block preserved', () => {
	const input = [
		'```',
		'<!-- not',
		'stripped -->',
		'```',
		'',
	].join('\n')
	assert.strictEqual(strip_html_comments(input), input)
})

test('strip_html_comments: multiple comments on one line', () => {
	assert.strictEqual(
		strip_html_comments([
			'a <!-- x --> b <!-- y --> c',
			'',
		].join('\n')),
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
		].join('\n')),
		[
			'a ',
			' b',
			'c',
			'',
		].join('\n'),
	)
})
