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
