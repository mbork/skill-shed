// * Imports
import type {LintMessage} from './lint.ts'
import type {Manifest} from './manifest.ts'

// * strip_trailing_punctuation
// Trims trailing characters a URL picks up from surrounding prose or Markdown wrappers.
// Sentence/closing punctuation (`. , ; : ! ? ] }`) is always trimmed; a trailing `)` is
// trimmed only when unbalanced (more `)` than `(` in the URL), so a wrapper or sentence paren
// goes but a `)` that closes a `(` inside the path stays.  Loops so an interleaved tail like
// `).` resolves fully.
const TRAILING_PUNCTUATION_RE = /[.,;:!?\]}]+$/

function strip_trailing_punctuation(url: string): string {
	let result = url
	let previous: string
	do {
		previous = result
		result = result.replace(TRAILING_PUNCTUATION_RE, '')
		const opens = (result.match(/\(/g) ?? []).length
		const closes = (result.match(/\)/g) ?? []).length
		if (result.endsWith(')') && closes > opens) {
			result = result.slice(0, -1)
		}
	} while (result !== previous)
	return result
}

// * extract_url_occurrences
// Every http(s) URL in `content`, NOT deduped, each paired with its 0-based line index.  A URL
// body runs from `https?://` up to the first whitespace or one of the delimiters `< > " ' \`` — so
// autolinks (`<url>`), inline code (`` `url` ``), and HTML attributes (`href="url"`) terminate
// cleanly — then `strip_trailing_punctuation` trims a sentence/wrapper tail (closing punctuation
// always; a trailing `)` only when unbalanced).  Schemes other than http(s) are not matched.
// `check_urls` needs one entry per occurrence (to warn at every site) and the line (to locate it);
// since a URL never spans a line (its body stops at any whitespace, `\n` included), scanning line
// by line is equivalent to scanning the whole string and yields the line index for free.
const URL_RE = /https?:\/\/[^\s<>"'`]+/g

export interface UrlOccurrence {
	url: string
	line: number // 0-based line index within `content`
}

export function extract_url_occurrences(content: string): UrlOccurrence[] {
	const occurrences: UrlOccurrence[] = []
	const lines = content.split('\n')
	for (let i = 0; i < lines.length; i++) {
		for (const match of lines[i].matchAll(URL_RE)) {
			occurrences.push({url: strip_trailing_punctuation(match[0]), line: i})
		}
	}
	return occurrences
}

// * extract_urls
// The deduped projection of `extract_url_occurrences`: every http(s) URL in `content`, deduped, in
// first-occurrence order.  Used where only the set of distinct URLs matters, not their positions.
export function extract_urls(content: string): string[] {
	const seen = new Set<string>()
	const urls: string[] = []
	for (const {url} of extract_url_occurrences(content)) {
		if (seen.has(url)) {
			continue
		}
		seen.add(url)
		urls.push(url)
	}
	return urls
}

// * UrlStatus
// The outcome of probing one URL.  `check_urls` turns every non-`ok` status into a lint warning.
export type UrlStatus
	= | {kind: 'ok'}
		| {kind: 'auth', status: number}
		| {kind: 'bad-status', status: number}
		| {kind: 'unreachable', reason: string}

// * classify_status
// Maps a final HTTP status to a `UrlStatus`.  401 and 403 are called out as `auth` (the resource
// likely exists but needs credentials); any other non-2xx — including a 3xx left unresolved
// because a redirect carried no `Location` — is `bad-status`.  Exported for direct unit testing:
// the `status < 200` branch is unreachable through `fetch` (whose final responses are always
// >= 200) but is trivially exercised by a unit call.
export function classify_status(status: number): UrlStatus {
	if (status === 401 || status === 403) {
		return {kind: 'auth', status}
	} else if (status >= 200 && status <= 299) {
		return {kind: 'ok'}
	} else {
		return {kind: 'bad-status', status}
	}
}

// * describe_fetch_error
// Reduces a rejected `fetch` to a short reason for an "unreachable" warning.  An abort (the
// `AbortController` deadline firing) reads as `timeout`; a network failure (DNS, refused
// connection, TLS) carries the useful detail on `error.cause`, so prefer that; otherwise fall
// back to the error's own message.  Exported for direct unit testing.
export function describe_fetch_error(error: unknown): string {
	if (!(error instanceof Error)) {
		return String(error)
	} else if (error.name === 'AbortError') {
		return 'timeout'
	} else if (error.cause instanceof Error) {
		return error.cause.message
	} else {
		return error.message
	}
}

// * fetch_no_body
// One `fetch` under an `AbortController` deadline of `timeout_ms`, following redirects and
// cancelling the response body before returning (so a `GET` retry never downloads its payload).
async function fetch_no_body(
	url: string,
	method: 'HEAD' | 'GET',
	timeout_ms: number,
): Promise<Response> {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeout_ms)
	try {
		const response = await fetch(url, {method, redirect: 'follow', signal: controller.signal})
		await response.body?.cancel()
		return response
	} finally {
		clearTimeout(timer)
	}
}

// * check_url
// Probes one URL and classifies the outcome.  A `HEAD` goes first (no body to download); a
// 405/501 means `HEAD` itself is unsupported (not the resource), so it retries once with `GET`.
// A rejected fetch (timeout, DNS, refused, TLS) is `unreachable`; otherwise the final status is
// handed to `classify_status`.
export async function check_url(url: string, timeout_ms: number): Promise<UrlStatus> {
	try {
		const head_response = await fetch_no_body(url, 'HEAD', timeout_ms)
		const is_head_supported = head_response.status !== 405 && head_response.status !== 501
		if (is_head_supported) {
			return classify_status(head_response.status)
		} else {
			const get_response = await fetch_no_body(url, 'GET', timeout_ms)
			return classify_status(get_response.status)
		}
	} catch (error) {
		return {kind: 'unreachable', reason: describe_fetch_error(error)}
	}
}

// * check_urls
// Checks every http(s) URL across a manifest's string content and returns one `warning` per
// occurrence of a non-OK URL (an OK URL emits nothing).  Each unique URL is probed once over the
// network; the warning still names the full URL the author wrote.
const URL_CHECK_CONCURRENCY = 8

interface UrlSite {
	url: string
	file: string
	line: number // 1-based source line, ready for messages
}

// Walks string `target_content`, translating each occurrence's content-line index to a 1-based
// source line via `line_map` (identity for verbatim .md files).  Binary entries are skipped.
function collect_url_sites(manifest: Manifest): UrlSite[] {
	const sites: UrlSite[] = []
	for (const entry of manifest) {
		if (typeof entry.target_content !== 'string') {
			continue
		}
		for (const {url, line} of extract_url_occurrences(entry.target_content)) {
			const source_line = (entry.line_map?.[line] ?? line) + 1
			sites.push({url, file: entry.source_name, line: source_line})
		}
	}
	return sites
}

// Memo key: a URL minus its `#fragment`.  Fragments are client-side (never sent to the server),
// so `.../a` and `.../a#install` are one network resource and share a single probe.
function probe_key(url: string): string {
	const hash_index = url.indexOf('#')
	if (hash_index === -1) {
		return url
	}
	return url.slice(0, hash_index)
}

// Probes each key once, at most `URL_CHECK_CONCURRENCY` in flight.  Workers pull indices off a
// shared cursor; `next++` is atomic between awaits (single-threaded), so no key is probed twice.
async function probe_keys(keys: string[], timeout_ms: number): Promise<Map<string, UrlStatus>> {
	const results = new Map<string, UrlStatus>()
	let next = 0
	async function worker(): Promise<void> {
		while (next < keys.length) {
			const key = keys[next++]
			results.set(key, await check_url(key, timeout_ms))
		}
	}
	const pool_size = Math.min(URL_CHECK_CONCURRENCY, keys.length)
	const workers: Promise<void>[] = []
	for (let i = 0; i < pool_size; i++) {
		workers.push(worker())
	}
	await Promise.all(workers)
	return results
}

// Warning text for a non-OK status; null for OK, which emits nothing.
function describe_url_status(url: string, status: UrlStatus): string | null {
	if (status.kind === 'ok') {
		return null
	}
	if (status.kind === 'auth') {
		return `URL may require auth (HTTP ${status.status}): ${url}`
	}
	if (status.kind === 'bad-status') {
		return `URL returned HTTP ${status.status}: ${url}`
	}
	return `URL unreachable (${status.reason}): ${url}`
}

export async function check_urls(
	manifest: Manifest,
	options: {timeout_ms: number},
): Promise<LintMessage[]> {
	const sites = collect_url_sites(manifest)
	const keys = [...new Set(sites.map(site => probe_key(site.url)))]
	const results = await probe_keys(keys, options.timeout_ms)
	const messages: LintMessage[] = []
	for (const site of sites) {
		const status = results.get(probe_key(site.url))!
		const message = describe_url_status(site.url, status)
		if (message !== null) {
			messages.push({file: site.file, line: site.line, severity: 'warning', message})
		}
	}
	return messages
}
