// * Imports
import {test, describe, before, after, beforeEach, afterEach} from 'node:test'
import assert from 'node:assert/strict'
import {
	extract_urls,
	extract_url_occurrences,
	classify_status,
	describe_fetch_error,
	check_url,
	check_urls,
} from '../src/check-urls.ts'
import {start_test_server, closed_port} from './http-test-server.ts'
import type {TestServer} from './http-test-server.ts'
import type {ManifestEntry} from '../src/manifest.ts'

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

// * classify_status
// Contract: 200-299 -> ok; 401/403 -> auth (carrying the status); every other status -> bad-status
// (carrying the status).  The status set is open-ended, so this is unit-tested directly; the
// `status < 200` case cannot arise from `fetch` but the branch still classifies as bad-status.

test('classify_status: a 200 is ok', () => {
	assert.deepStrictEqual(classify_status(200), {kind: 'ok'})
})

test('classify_status: a 299 is ok', () => {
	assert.deepStrictEqual(classify_status(299), {kind: 'ok'})
})

test('classify_status: a 401 is auth', () => {
	assert.deepStrictEqual(classify_status(401), {kind: 'auth', status: 401})
})

test('classify_status: a 403 is auth', () => {
	assert.deepStrictEqual(classify_status(403), {kind: 'auth', status: 403})
})

test('classify_status: a 404 is bad-status', () => {
	assert.deepStrictEqual(classify_status(404), {kind: 'bad-status', status: 404})
})

test('classify_status: a 500 is bad-status', () => {
	assert.deepStrictEqual(classify_status(500), {kind: 'bad-status', status: 500})
})

test('classify_status: an unresolved 3xx is bad-status', () => {
	assert.deepStrictEqual(classify_status(302), {kind: 'bad-status', status: 302})
})

test('classify_status: a sub-200 status is bad-status', () => {
	// Unreachable through `fetch` (final responses are always >= 200), but the branch exists.
	assert.deepStrictEqual(classify_status(100), {kind: 'bad-status', status: 100})
})

// * describe_fetch_error
// Contract: an abort -> `timeout`; an error with an `Error` cause -> the cause's message; any
// other `Error` -> its own message; a non-`Error` rejection -> its string form.

test('describe_fetch_error: an abort reads as timeout', () => {
	const error = new Error('the operation was aborted')
	error.name = 'AbortError'
	assert.equal(describe_fetch_error(error), 'timeout')
})

test('describe_fetch_error: a network error reports its cause message', () => {
	const error = new Error('fetch failed', {cause: new Error('getaddrinfo ENOTFOUND host')})
	assert.equal(describe_fetch_error(error), 'getaddrinfo ENOTFOUND host')
})

test('describe_fetch_error: an error with no Error cause reports its own message', () => {
	assert.equal(describe_fetch_error(new Error('connection reset by peer')), 'connection reset by peer')
})

test('describe_fetch_error: a non-Error rejection is stringified', () => {
	assert.equal(describe_fetch_error('a bare string rejection'), 'a bare string rejection')
})

// * check_url
// Contract: probe a URL with a `HEAD` (retrying once with `GET` on 405/501), follow redirects,
// and classify the final response — 2xx ok, 401/403 auth, other status bad-status, a rejected
// fetch unreachable.  Driven against the in-process local server (see `http-test-server.ts`).

describe('check_url', () => {
	let server: TestServer

	// One shared server: these tests assert only on check_url's return value, never on
	// server.count(), so accumulated request history does not matter.
	before(async () => {
		server = await start_test_server()
	})

	after(() => server.close())

	test('check_url: a 200 is ok', async () => {
		assert.deepStrictEqual(await check_url(server.url('/ok'), 1000), {kind: 'ok'})
	})

	test('check_url: follows a redirect through to a 200 (ok)', async () => {
		assert.deepStrictEqual(await check_url(server.url('/redirect'), 1000), {kind: 'ok'})
	})

	test('check_url: a 401 is auth', async () => {
		assert.deepStrictEqual(await check_url(server.url('/auth'), 1000), {kind: 'auth', status: 401})
	})

	test('check_url: a 403 is auth', async () => {
		assert.deepStrictEqual(await check_url(server.url('/forbidden'), 1000), {kind: 'auth', status: 403})
	})

	test('check_url: a 404 is bad-status', async () => {
		assert.deepStrictEqual(await check_url(server.url('/missing'), 1000), {kind: 'bad-status', status: 404})
	})

	test('check_url: a 500 is bad-status', async () => {
		assert.deepStrictEqual(await check_url(server.url('/boom'), 1000), {kind: 'bad-status', status: 500})
	})

	test('check_url: retries with GET when HEAD returns 405, then classifies the GET (ok)', async () => {
		assert.deepStrictEqual(await check_url(server.url('/head-405'), 1000), {kind: 'ok'})
	})

	test('check_url: a hung response times out (unreachable)', async () => {
		assert.deepStrictEqual(
			await check_url(server.url('/never'), 100),
			{kind: 'unreachable', reason: 'timeout'},
		)
	})

	test('check_url: a refused connection is unreachable (real ECONNREFUSED, not a timeout)', async () => {
		const port = await closed_port()
		const result = await check_url(`http://127.0.0.1:${port}/`, 1000)
		assert(result.kind === 'unreachable')
		assert.ok(result.reason.includes('ECONNREFUSED'))
	})
})

// * extract_url_occurrences
// Contract: every occurrence (NOT deduped) paired with its 0-based line index — the positional
// counterpart of `extract_urls`.

test('extract_url_occurrences: reports the 0-based line index of each URL', () => {
	const content = [
		'# Title',
		'',
		'See https://agentskills.io/specification for the rules.',
	].join('\n')
	assert.deepStrictEqual(
		extract_url_occurrences(content),
		[{url: 'https://agentskills.io/specification', line: 2}],
	)
})

test('extract_url_occurrences: keeps duplicates, one entry per occurrence, with their lines', () => {
	const content = [
		'https://example.com/a',
		'https://example.com/a',
	].join('\n')
	assert.deepStrictEqual(
		extract_url_occurrences(content),
		[
			{url: 'https://example.com/a', line: 0},
			{url: 'https://example.com/a', line: 1},
		],
	)
})

test('extract_url_occurrences: finds multiple URLs on one line', () => {
	assert.deepStrictEqual(
		extract_url_occurrences('a https://example.com/x and https://example.com/y here'),
		[
			{url: 'https://example.com/x', line: 0},
			{url: 'https://example.com/y', line: 0},
		],
	)
})

// * check_urls
// Contract: one `warning` per occurrence of a non-OK URL across the manifest's string content
// (OK emits nothing); each unique URL — keyed minus its `#fragment` — is probed once; warnings
// name the full URL and locate it by file + 1-based source line (line_map-translated).  Driven
// against the local server; a fresh server per test keeps `count()` assertions independent.

function md_entry(source_name: string, target_content: string, line_map?: number[]): ManifestEntry {
	return {
		source_name,
		target_name: source_name,
		source_content: target_content,
		target_content,
		line_map,
	}
}

// A Buffer entry whose bytes happen to spell `content` — used to prove that binary entries are
// skipped, not decoded and scanned for URLs.
function binary_entry(source_name: string, content: string): ManifestEntry {
	const buffer = Buffer.from(content)
	return {source_name, target_name: source_name, source_content: buffer, target_content: buffer}
}

describe('check_urls', () => {
	let server: TestServer

	// A fresh server per test: some tests assert server.count(), which accumulates over a
	// server's lifetime, so each test needs a clean count to stay independent.
	beforeEach(async () => {
		server = await start_test_server()
	})

	afterEach(() => server.close())

	test('check_urls: clean URLs produce no messages', async () => {
		const entry = md_entry('SKILL.md', `ok ${server.url('/ok')} and ${server.url('/redirect')}`)
		assert.deepStrictEqual(await check_urls([entry], {timeout_ms: 1000}), [])
	})

	test('check_urls: a 404 yields one bad-status warning at the right file and line', async () => {
		const content = ['# Skill', '', `Broken: ${server.url('/missing')}`].join('\n')
		const messages = await check_urls([md_entry('guide.md', content)], {timeout_ms: 1000})
		assert.deepStrictEqual(messages, [{
			file: 'guide.md',
			line: 3,
			severity: 'warning',
			message: `URL returned HTTP 404: ${server.url('/missing')}`,
		}])
	})

	test('check_urls: a 401 yields an auth warning', async () => {
		const messages = await check_urls(
			[md_entry('SKILL.md', server.url('/auth'))],
			{timeout_ms: 1000},
		)
		assert.deepStrictEqual(messages, [{
			file: 'SKILL.md',
			line: 1,
			severity: 'warning',
			message: `URL may require auth (HTTP 401): ${server.url('/auth')}`,
		}])
	})

	test('check_urls: an unreachable URL yields a warning (timeout)', async () => {
		const messages = await check_urls(
			[md_entry('SKILL.md', server.url('/never'))],
			{timeout_ms: 100},
		)
		assert.deepStrictEqual(messages, [{
			file: 'SKILL.md',
			line: 1,
			severity: 'warning',
			message: `URL unreachable (timeout): ${server.url('/never')}`,
		}])
	})

	test('check_urls: warns once per occurrence of a repeated URL but probes it only once', async () => {
		const content = [server.url('/missing'), server.url('/missing')].join('\n')
		const messages = await check_urls([md_entry('SKILL.md', content)], {timeout_ms: 1000})
		assert.deepStrictEqual(messages, [
			{
				file: 'SKILL.md', line: 1, severity: 'warning',
				message: `URL returned HTTP 404: ${server.url('/missing')}`,
			},
			{
				file: 'SKILL.md', line: 2, severity: 'warning',
				message: `URL returned HTTP 404: ${server.url('/missing')}`,
			},
		])
		assert.equal(server.count('/missing'), 1)
	})

	test('check_urls: URLs differing only by #fragment share one probe but each warns', async () => {
		const content = [`${server.url('/missing')}#install`, `${server.url('/missing')}#usage`].join('\n')
		const messages = await check_urls([md_entry('SKILL.md', content)], {timeout_ms: 1000})
		assert.deepStrictEqual(messages, [
			{
				file: 'SKILL.md', line: 1, severity: 'warning',
				message: `URL returned HTTP 404: ${server.url('/missing')}#install`,
			},
			{
				file: 'SKILL.md', line: 2, severity: 'warning',
				message: `URL returned HTTP 404: ${server.url('/missing')}#usage`,
			},
		])
		assert.equal(server.count('/missing'), 1)
	})

	test('check_urls: checks URLs across multiple files', async () => {
		const messages = await check_urls([
			md_entry('SKILL.md', server.url('/missing')),
			md_entry('guide.md', server.url('/boom')),
		], {timeout_ms: 1000})
		assert.deepStrictEqual(messages, [
			{
				file: 'SKILL.md', line: 1, severity: 'warning',
				message: `URL returned HTTP 404: ${server.url('/missing')}`,
			},
			{
				file: 'guide.md', line: 1, severity: 'warning',
				message: `URL returned HTTP 500: ${server.url('/boom')}`,
			},
		])
	})

	test('check_urls: a clean URL alongside a bad one yields exactly one warning', async () => {
		const content = [server.url('/ok'), server.url('/missing')].join('\n')
		const messages = await check_urls([md_entry('SKILL.md', content)], {timeout_ms: 1000})
		assert.deepStrictEqual(messages, [{
			file: 'SKILL.md',
			line: 2,
			severity: 'warning',
			message: `URL returned HTTP 404: ${server.url('/missing')}`,
		}])
	})

	test('check_urls: does not scan binary entries (a URL in their bytes is never probed)', async () => {
		// If this Buffer were wrongly decoded and scanned, /missing would be requested.  Because
		// it is binary it must be skipped, so the server never sees it and no warning is emitted.
		const messages = await check_urls(
			[binary_entry('logo.png', `see ${server.url('/missing')}`)],
			{timeout_ms: 1000},
		)
		assert.deepStrictEqual(messages, [])
		assert.equal(server.count('/missing'), 0)
	})

	test('check_urls: translates the reported line through line_map (.source.md)', async () => {
		// URL sits on content line index 2; line_map maps that to source line index 5 -> line 6.
		const content = ['# Skill', '', server.url('/missing')].join('\n')
		const messages = await check_urls(
			[md_entry('SKILL.source.md', content, [0, 1, 5])],
			{timeout_ms: 1000},
		)
		assert.equal(messages[0].line, 6)
	})
})
