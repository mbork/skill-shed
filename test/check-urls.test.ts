// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {extract_urls} from '../src/check-urls.ts'

// * extract_urls
// Contract: return every http(s) URL in `content`, deduped, in first-occurrence order.
// A URL body runs from `https?://` up to (but not including) whitespace or one of the
// delimiters `< > " ' \``; then a trailing run of sentence/closing punctuation
// (`. , ; : ! ? ] }`) is stripped.  A trailing `)` is stripped only when unbalanced (more
// `)` than `(` in the URL), so a Markdown/sentence wrapper `(url)` loses its paren while a
// path that legitimately contains balanced parens — e.g. `..._(programming)` — keeps it.
// Schemes other than http(s) are ignored.

// ** Basic extraction

test('extract_urls: finds a bare https URL in prose', () => {
	assert.deepStrictEqual(
		extract_urls('See https://agentskills.io/specification for the rules.'),
		['https://agentskills.io/specification'],
	)
})

test('extract_urls: finds a bare http URL', () => {
	assert.deepStrictEqual(
		extract_urls('Legacy docs live at http://example.com/old'),
		['http://example.com/old'],
	)
})

test('extract_urls: returns an empty array when no URL is present', () => {
	assert.deepStrictEqual(extract_urls('Just some prose with no links at all.'), [])
})

test('extract_urls: ignores non-http(s) schemes and scheme-less hosts', () => {
	const content = 'Try ftp://example.com, mailto:dev@example.com, ./guide.md, '
		+ '#section, or www.example.com.'
	assert.deepStrictEqual(extract_urls(content), [])
})

test('extract_urls: preserves path, query, and fragment', () => {
	assert.deepStrictEqual(
		extract_urls('Search https://nodejs.org/api/test.html?q=run&n=2#test-runner here.'),
		['https://nodejs.org/api/test.html?q=run&n=2#test-runner'],
	)
})

// ** Markdown and HTML wrappers

test('extract_urls: strips the closing paren of an inline Markdown link', () => {
	assert.deepStrictEqual(
		extract_urls('Read [the spec](https://agentskills.io/specification) first.'),
		['https://agentskills.io/specification'],
	)
})

test('extract_urls: strips the angle brackets of an autolink', () => {
	assert.deepStrictEqual(
		extract_urls('Autolink: <https://agentskills.io/specification> works too.'),
		['https://agentskills.io/specification'],
	)
})

test('extract_urls: strips wrapping parentheses around a bare URL', () => {
	assert.deepStrictEqual(
		extract_urls('(https://agentskills.io/specification)'),
		['https://agentskills.io/specification'],
	)
})

test('extract_urls: ends the URL at an inline-code backtick', () => {
	assert.deepStrictEqual(
		extract_urls('Run against `https://agentskills.io/specification` to verify.'),
		['https://agentskills.io/specification'],
	)
})

test('extract_urls: ends the URL at a double quote (HTML attribute form)', () => {
	assert.deepStrictEqual(
		extract_urls('<a href="https://agentskills.io/specification">spec</a>'),
		['https://agentskills.io/specification'],
	)
})

// ** Trailing punctuation

test('extract_urls: strips a trailing sentence period', () => {
	assert.deepStrictEqual(
		extract_urls('The reference is https://agentskills.io/specification.'),
		['https://agentskills.io/specification'],
	)
})

test('extract_urls: strips a trailing comma', () => {
	assert.deepStrictEqual(
		extract_urls('See https://agentskills.io/specification, then deploy.'),
		['https://agentskills.io/specification'],
	)
})

test('extract_urls: strips a trailing question mark', () => {
	assert.deepStrictEqual(
		extract_urls('Did you read https://agentskills.io/specification?'),
		['https://agentskills.io/specification'],
	)
})

test('extract_urls: strips a run of trailing punctuation (paren then comma)', () => {
	assert.deepStrictEqual(
		extract_urls('First (https://agentskills.io/specification), then ship.'),
		['https://agentskills.io/specification'],
	)
})

test('extract_urls: keeps a dot inside the path (not a trailing dot)', () => {
	assert.deepStrictEqual(
		extract_urls('Open https://nodejs.org/api/test.html now.'),
		['https://nodejs.org/api/test.html'],
	)
})

// ** Dedupe, order, and multiplicity

test('extract_urls: dedupes identical URLs', () => {
	const content = 'https://agentskills.io/specification and again '
		+ 'https://agentskills.io/specification'
	assert.deepStrictEqual(extract_urls(content), ['https://agentskills.io/specification'])
})

test('extract_urls: returns distinct URLs in first-occurrence order', () => {
	const content = 'First https://agentskills.io/specification then https://nodejs.org/api/test.html'
	assert.deepStrictEqual(
		extract_urls(content),
		['https://agentskills.io/specification', 'https://nodejs.org/api/test.html'],
	)
})

test('extract_urls: extracts URLs from multiple lines', () => {
	const content = [
		'See https://agentskills.io/specification for the spec.',
		'See https://nodejs.org/api/test.html for the runner.',
	].join('\n')
	assert.deepStrictEqual(
		extract_urls(content),
		['https://agentskills.io/specification', 'https://nodejs.org/api/test.html'],
	)
})

test('extract_urls: ends a URL at the following whitespace', () => {
	assert.deepStrictEqual(
		extract_urls('Open https://example.com/path and read on.'),
		['https://example.com/path'],
	)
})

// ** Balanced parentheses
// A trailing `)` is stripped only when it is unbalanced (a wrapper or sentence paren); a `)`
// that closes a `(` inside the URL is part of the path and kept.

test('extract_urls: keeps a balanced trailing paren inside the path', () => {
	// Wikipedia/MDN-style disambiguation paths: the `)` closes the `(` in `Skill_(programming)`,
	// so it is structural and must survive.
	assert.deepStrictEqual(
		extract_urls('See https://en.wikipedia.org/wiki/Skill_(programming) for context.'),
		['https://en.wikipedia.org/wiki/Skill_(programming)'],
	)
})

test('extract_urls: strips all wrapping parens around a bare URL (none balanced in the URL)', () => {
	assert.deepStrictEqual(
		extract_urls('((https://example.com))'),
		['https://example.com'],
	)
})

test('extract_urls: strips the wrapper paren but keeps the balanced path paren', () => {
	// Markdown link wrapping a URL that itself ends in a balanced paren: only the outer wrapper
	// `)` is unbalanced, so exactly one trailing `)` is dropped.
	assert.deepStrictEqual(
		extract_urls('Read [the article](https://en.wikipedia.org/wiki/Skill_(programming)) now.'),
		['https://en.wikipedia.org/wiki/Skill_(programming)'],
	)
})

test('extract_urls: strips a mixed wrapper-paren-then-period tail, keeping the path paren', () => {
	// Tail is `)).` — the sentence period and the single unbalanced wrapper `)` are stripped,
	// the balanced path `)` is kept.
	assert.deepStrictEqual(
		extract_urls('(see https://en.wikipedia.org/wiki/Skill_(programming)).'),
		['https://en.wikipedia.org/wiki/Skill_(programming)'],
	)
})
