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

// * extract_urls
// Returns every http(s) URL in `content`, deduped, in first-occurrence order.  A URL body
// runs from `https?://` up to the first whitespace or one of the delimiters `< > " ' \`` — so
// autolinks (`<url>`), inline code (`` `url` ``), and HTML attributes (`href="url"`) terminate
// cleanly.  Trailing punctuation is then trimmed by `strip_trailing_punctuation` (sentence and
// closing punctuation always; a trailing `)` only when unbalanced), so a URL ending a sentence
// or wrapped in `(...)` comes out clean while a balanced path paren survives.  Schemes other
// than http(s) are not matched.
const URL_RE = /https?:\/\/[^\s<>"'`]+/g

export function extract_urls(content: string): string[] {
	const seen = new Set<string>()
	const urls: string[] = []
	for (const match of content.matchAll(URL_RE)) {
		const url = strip_trailing_punctuation(match[0])
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
