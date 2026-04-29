// * Frontmatter extraction
// Parses the YAML frontmatter block at the start of a SKILL.md file.
// Delimiter rules: opening `---` at column 0, line 0 (trailing whitespace allowed);
// closing `---` or `...` at column 0 (trailing whitespace allowed).
// See: https://yaml.org/spec/1.2.2/#912-document-markers
//      https://jekyllrb.com/docs/front-matter/
//      https://pandoc.org/MANUAL.html#extension-yaml_metadata_block

import {parseDocument, isMap, isScalar} from 'yaml'

// * Types

// kind: 'none'  — file does not start with ---; no frontmatter present
// kind: 'error' — frontmatter block found but malformed (unclosed or invalid YAML)
// kind: 'ok'    — frontmatter parsed successfully
export type FrontmatterResult
	= | {kind: 'none'}
		| {kind: 'error', message: string}
		| {
			kind: 'ok'
			fields: Record<string, unknown>
			body: string
			field_lines: Map<string, number> // key → 1-based file line number
		}

// * extract_frontmatter
export function extract_frontmatter(content: string): FrontmatterResult {
	const lines = content.split('\n')

	if (!lines[0]?.match(/^---\s*$/)) {
		return {kind: 'none'}
	}

	let close_line = -1
	for (let i = 1; i < lines.length; i++) {
		if (/^(---|\.\.\.)\s*$/.test(lines[i])) {
			close_line = i
			break
		}
	}

	if (close_line === -1) {
		return {kind: 'error', message: 'unclosed frontmatter (no closing --- or ...)'}
	}

	const yaml_content = lines.slice(1, close_line).join('\n')
	const body = lines.slice(close_line + 1).join('\n')
	const doc = parseDocument(yaml_content)

	if (doc.errors.length > 0) {
		const messages = doc.errors.map(e => e.message).join('; ')
		return {kind: 'error', message: `invalid YAML in frontmatter: ${messages}`}
	}

	if (doc.contents !== null && !isMap(doc.contents)) {
		return {kind: 'error', message: 'frontmatter must be a YAML mapping'}
	}

	const fields = (doc.toJSON() ?? {}) as Record<string, unknown>

	// Map each top-level key to its 1-based file line number.
	// yaml offsets are relative to yaml_content, which starts on file line 1 (0-based)
	// (line 0 is the opening ---).  Conversion: file_line_1based = yaml_line_0based + 2.
	const field_lines = new Map<string, number>()
	if (doc.contents !== null) {
		for (const pair of doc.contents.items) {
			if (!isScalar(pair.key) || typeof pair.key.value !== 'string' || !pair.key.range) {
				continue
			}
			const prefix = yaml_content.slice(0, pair.key.range[0])
			const yaml_line_0based = prefix.split('\n').length - 1
			field_lines.set(pair.key.value, yaml_line_0based + 2)
		}
	}

	return {kind: 'ok', fields, body, field_lines}
}
