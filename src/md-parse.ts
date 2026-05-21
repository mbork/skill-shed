// * Markdown parsing primitives
// Composable, stateful trackers for Markdown structural features.  Kept here so that
// strip_html_comments, the linter, and future heading-based checks (duplicate/empty
// sections) share a single state machine for each concern.

// * make_fence_tracker
// Factory for a stateful Markdown fence tracker.  Shared between strip_html_comments
// (which must not strip comments inside code fences), the lint check for unclosed
// fences, and the heading classifier below (a `#` inside a fence is code, not a heading).
//
// Scope note: the unclosed-fence lint check is technically outside the linter's stated
// scope ("skill correctness, not Markdown syntax; check only what skill-shed owns via
// transform").  It is included as a cost-of-opportunity exception — this tracker is
// needed anyway for the heading checks, so the unclosed-fence report is effectively
// free.  This is not a precedent for other Markdown-syntax checks.
export function make_fence_tracker() {
	let is_in_fence = false
	let fence_char = ''
	let fence_min_length = 0
	let open_line: number | null = null

	return {
		// Returns true if the line is part of a fence (opener, body, or closer) —
		// i.e. the caller should pass it through unchanged rather than parsing it as
		// regular Markdown.  Updates internal state as a side effect.
		feed(line: string, line_idx: number): boolean {
			if (is_in_fence) {
				const close_match = line.match(/^(`{3,}|~{3,})\s*$/)
				if (
					close_match
					&& close_match[1][0] === fence_char
					&& close_match[1].length >= fence_min_length
				) {
					is_in_fence = false
					open_line = null
				}
				return true
			}
			const open_match = line.match(/^(`{3,}|~{3,})/)
			if (open_match) {
				is_in_fence = true
				fence_char = open_match[1][0]
				fence_min_length = open_match[1].length
				open_line = line_idx
				return true
			}
			return false
		},
		get is_open(): boolean {
			return is_in_fence
		},
		get unclosed_line(): number | null {
			return open_line
		},
	}
}

// * Heading classification
// Building blocks for heading-based lint checks (empty sections, planned
// duplicate-headings, etc.).  Fence-aware via make_fence_tracker.

// ATX heading line: 0-3 leading spaces, 1-6 hashes, then either end-of-line or at least
// one space/tab followed by title text (with an optional CommonMark closing-`#` sequence
// preceded by whitespace, stripped from the captured title).  Four or more leading spaces
// would make the line an indented code block (CommonMark).
// Group 1 = hashes (length = level).  Group 2 = title text, or undefined if no title.
export const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*)?$/

export type LineKind
	= | {kind: 'heading', level: number, text: string}
		| {kind: 'blank'}
		| {kind: 'content'}

// Classify each line of `content`.  Lines inside fenced code blocks (opener, body, closer)
// are all classified as 'content' — including ones that look like headings or are blank.
export function classify_lines(content: string): LineKind[] {
	const lines = content.split('\n')
	const fence = make_fence_tracker()
	const kinds: LineKind[] = []
	for (let i = 0; i < lines.length; i++) {
		const is_fence_line = fence.feed(lines[i], i)
		const heading_match = lines[i].match(HEADING_RE)
		if (is_fence_line) {
			kinds.push({kind: 'content'})
		} else if (lines[i].trim() === '') {
			kinds.push({kind: 'blank'})
		} else if (heading_match) {
			kinds.push({
				kind: 'heading',
				level: heading_match[1].length,
				text: heading_match[2] ?? '',
			})
		} else {
			kinds.push({kind: 'content'})
		}
	}
	return kinds
}

// True if the section opened by the heading at `heading_line_number` (level `heading_level`)
// contains no content before either EOF or another heading at the same or higher level.
// Subsections (heading at strictly greater depth) count as content.
export function is_section_empty(
	kinds: LineKind[],
	heading_line_number: number,
	heading_level: number,
): boolean {
	for (let j = heading_line_number + 1; j < kinds.length; j++) {
		const next = kinds[j]
		if (next.kind === 'heading') {
			return next.level <= heading_level
		} else if (next.kind === 'content') {
			return false
		}
		// line blank, keep scanning
	}
	return true
}
