// * Markdown parsing primitives
// Composable, stateful trackers for Markdown structural features.  Kept here so that
// strip_html_comments, the linter, and future heading-based checks (duplicate/empty
// sections) share a single state machine for each concern.

// * make_fence_tracker
// Factory for a stateful Markdown fence tracker.  Shared between strip_html_comments
// (which must not strip comments inside code fences) and the lint check for unclosed
// fences.  Future heading-based checks (duplicate/empty sections) will also use it,
// because a `#` inside a fence is code, not a heading.
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
