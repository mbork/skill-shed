// * Strip HTML comments from Markdown
// Fenced-code-block-aware: comments inside ``` or ~~~ blocks are preserved.

export function strip_html_comments(content: string): string {
	const lines = content.split('\n')
	let is_in_fence = false
	let fence_char = ''
	let fence_min_length = 0
	let is_in_comment = false
	let was_last_pushed_blank = false
	let was_comment_stripped = false
	const result: string[] = []

	for (const line of lines) {
		if (is_in_fence) {
			const match = line.match(/^(`{3,}|~{3,})\s*$/)
			if (match && match[1][0] === fence_char && match[1].length >= fence_min_length) {
				is_in_fence = false
			}
			result.push(line)
			was_last_pushed_blank = line.trim() === ''
			was_comment_stripped = false
			continue
		}

		// Check for fence opener
		const fence_match = line.match(/^(`{3,}|~{3,})/)
		if (fence_match) {
			is_in_fence = true
			fence_char = fence_match[1][0]
			fence_min_length = fence_match[1].length
			result.push(line)
			was_last_pushed_blank = false
			was_comment_stripped = false
			continue
		}

		// Strip HTML comments from this line
		let out = ''
		let i = 0
		while (i < line.length) {
			if (is_in_comment) {
				const end = line.indexOf('-->', i)
				if (end === -1) {
					i = line.length
				} else {
					is_in_comment = false
					i = end + 3
				}
			} else {
				const start = line.indexOf('<!--', i)
				if (start === -1) {
					out += line.slice(i)
					i = line.length
				} else {
					out += line.slice(i, start)
					is_in_comment = true
					i = start + 4
				}
			}
		}

		// Drop lines that were entirely consumed by comments
		if (out.trim() === '' && line.trim() !== '') {
			was_comment_stripped = true
			continue
		}

		// Suppress blank line that immediately follows a stripped comment block
		// when the line before the block was also blank
		if (out.trim() === '' && was_last_pushed_blank && was_comment_stripped) {
			was_comment_stripped = false
			continue
		}

		result.push(out)
		was_last_pushed_blank = out.trim() === ''
		was_comment_stripped = false
	}

	return result.join('\n')
}
