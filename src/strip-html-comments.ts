// * Strip HTML comments from Markdown
// Fenced-code-block-aware: comments inside ``` or ~~~ blocks are preserved.

export interface StripResult {
	content: string
	// line_map[i] is the 0-based source line index for output line i
	line_map: number[]
	// 0-based source line index where an unclosed <!-- begins, or null if all closed
	unclosed_comment_line: number | null
}

export function strip_html_comments(content: string): StripResult {
	const lines = content.split('\n')
	let is_in_fence = false
	let fence_char = ''
	let fence_min_length = 0
	let is_in_comment = false
	let unclosed_comment_line: number | null = null
	let was_last_pushed_blank = false
	let was_comment_stripped = false
	const result: string[] = []
	const line_map: number[] = []

	for (let src = 0; src < lines.length; src++) {
		const line = lines[src]

		if (is_in_fence) {
			const match = line.match(/^(`{3,}|~{3,})\s*$/)
			if (match && match[1][0] === fence_char && match[1].length >= fence_min_length) {
				is_in_fence = false
			}
			result.push(line)
			line_map.push(src)
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
			line_map.push(src)
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
					unclosed_comment_line = null
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
					unclosed_comment_line = src
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
		line_map.push(src)
		was_last_pushed_blank = out.trim() === ''
		was_comment_stripped = false
	}

	return {
		content: result.join('\n'),
		line_map,
		unclosed_comment_line,
	}
}
