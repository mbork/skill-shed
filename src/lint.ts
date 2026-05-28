// * Imports
import {basename} from 'node:path'
import {
	build_manifest,
	find_target_conflicts,
	type Manifest,
	type ManifestEntry,
	type ManifestSource,
} from './manifest.ts'
import {classify_lines, is_section_empty, make_fence_tracker} from './md-parse.ts'
import {extract_frontmatter, validate_frontmatter} from './frontmatter.ts'

// * Conventions
// Lint checks operate on `target_content` by default — i.e. what gets deployed (after any
// .source.md comment stripping), not the on-disk source.  A section that becomes empty only
// after stripping is still flagged; a fence opener that only appears inside a stripped
// comment is not.

// * Types

type LintSeverity = 'error' | 'warning'

export interface LintMessage {
	file: string
	line: number // 0 = whole-skill (no specific line)
	severity: LintSeverity
	message: string
}

// * format_lint_message
export function format_lint_message(msg: LintMessage): string {
	return `${msg.file}:${msg.line}: ${msg.severity}: ${msg.message}`
}

// * check_skill_md_exists
function check_skill_md_exists(skill_dir: string, manifest: Manifest): LintMessage[] {
	if (!manifest.some(e => e.target_name === 'SKILL.md')) {
		return [{file: skill_dir, line: 0, severity: 'error', message: 'no file targets SKILL.md'}]
	}
	return []
}

// * check_no_conflicts
function check_no_conflicts(skill_dir: string, manifest: Manifest): LintMessage[] {
	const conflicts = find_target_conflicts(manifest.map(e => e.source_name))
	return conflicts.map(group => ({
		file: skill_dir,
		line: 0,
		severity: 'error' as LintSeverity,
		message: `conflicting source files: ${group.join(', ')}`,
	}))
}

// * check_no_unclosed_comments
// Only checks .source.md files: .md files are deployed verbatim and comment structure
// is outside skill-shed's boundary.
function check_no_unclosed_comments(manifest: Manifest): LintMessage[] {
	const messages: LintMessage[] = []
	for (const entry of manifest) {
		if (entry.unclosed_comment_line != null) {
			messages.push({
				file: entry.source_name,
				line: entry.unclosed_comment_line + 1,
				severity: 'error',
				message: 'unclosed HTML comment',
			})
		}
	}
	return messages
}

// * check_no_unclosed_fences
// Applies to both .source.md and .md files.  For .source.md, unclosed_fence_line is
// already populated by strip_html_comments against source line indices (no line-map
// translation needed).  For .md, run a fresh tracker over the content.
function check_no_unclosed_fences(manifest: Manifest): LintMessage[] {
	const messages: LintMessage[] = []
	for (const entry of manifest) {
		if (typeof entry.target_content !== 'string') {
			continue
		}
		let unclosed_line: number | null
		if (entry.unclosed_fence_line !== undefined) {
			unclosed_line = entry.unclosed_fence_line
		} else {
			const fence = make_fence_tracker()
			const lines = entry.target_content.split('\n')
			for (let i = 0; i < lines.length; i++) {
				fence.feed(lines[i], i)
			}
			unclosed_line = fence.unclosed_line
		}
		if (unclosed_line === null) {
			continue
		}
		messages.push({
			file: entry.source_name,
			line: unclosed_line + 1,
			severity: 'error',
			message: 'unclosed fenced code block',
		})
	}
	return messages
}

// * get_body_start_line
// Heading checks must skip the frontmatter region of `SKILL.md` (a `#`-prefixed YAML
// comment at column 0 would otherwise be misclassified as an H1 heading).  Non-SKILL.md
// files do not have frontmatter; a leading `---` there is a Markdown horizontal rule, not
// a frontmatter delimiter, and the file body starts at line 0.
function get_body_start_line(entry: ManifestEntry): number {
	if (entry.target_name !== 'SKILL.md') {
		return 0
	}
	return extract_frontmatter(entry.target_content as string).body_start_line
}

// * check_no_empty_sections
// Severity: warning.  Runs over target content, so a section consisting only of comments
// stripped from .source.md is reported empty (which is correct: that's what gets deployed).
function check_no_empty_sections(manifest: Manifest): LintMessage[] {
	const messages: LintMessage[] = []
	for (const entry of manifest) {
		if (typeof entry.target_content !== 'string') {
			continue
		}
		const body_start = get_body_start_line(entry)
		const lines = entry.target_content.split('\n')
		const kinds = classify_lines(lines.slice(body_start))
		for (let i = 0; i < kinds.length; i++) {
			const k = kinds[i]
			if (k.kind !== 'heading') {
				continue
			}
			if (!is_section_empty(kinds, i, k.level)) {
				continue
			}
			const target_line = body_start + i
			const source_line = entry.line_map?.[target_line] ?? target_line
			messages.push({
				file: entry.source_name,
				line: source_line + 1,
				severity: 'warning',
				message: `empty section "${k.text}"`,
			})
		}
	}
	return messages
}

// * check_no_duplicate_headings
// Severity: warning.  Two kinds of duplicates are flagged, with distinct messages:
//   1. Siblings — two headings sharing the same direct parent AND the same level AND the same
//      (case-sensitive) title text.  Permits the common `# Tool A / ## Examples` +
//      `# Tool B / ## Examples` pattern while still flagging the typical "forgot to rename a
//      section" mistake.
//   2. Ancestor — a heading whose title matches one of its ancestors in the hierarchy (any
//      level, any depth).  Catches accidental nesting like `## Foo / ### Foo`.  When a heading
//      matches multiple ancestors, only the outermost (highest-level / smallest hash count) is
//      reported — that is the root of the duplication chain.
// Both checks run for every non-empty heading and can fire together on the same line.  Empty
// titles are skipped (already covered by `check_no_empty_heading_titles`).
function check_no_duplicate_headings(manifest: Manifest): LintMessage[] {
	const messages: LintMessage[] = []
	for (const entry of manifest) {
		if (typeof entry.target_content !== 'string') {
			continue
		}
		const body_start = get_body_start_line(entry)
		const lines = entry.target_content.split('\n')
		const kinds = classify_lines(lines.slice(body_start))
		// Stack tracks ancestors of the current heading.  The synthetic root frame at level 0
		// (text='', line=-1) holds top-level headings as siblings; each real frame stores the
		// heading's own text and body-relative line index for ancestor-match lookup, plus a
		// children_seen map of `${level}|${text}` → first-occurrence body-relative index for
		// sibling duplicate detection.  first_index is preserved (not overwritten) so all
		// later duplicates point back to the same first sibling.
		const stack: {
			level: number
			text: string
			line: number
			children_seen: Map<string, number>
		}[] = [{level: 0, text: '', line: -1, children_seen: new Map()}]
		for (let i = 0; i < kinds.length; i++) {
			const k = kinds[i]
			// Skip non-heading lines and empty headings — the latter are reported by
			// check_no_empty_heading_titles.
			if (k.kind !== 'heading' || k.text === '') {
				continue
			}
			// Unwind frames that aren't proper ancestors of this heading (same or deeper
			// level) so the top becomes its direct parent.
			while (stack[stack.length - 1].level >= k.level) {
				stack.pop()
			}
			const target_line = body_start + i
			const source_line = entry.line_map?.[target_line] ?? target_line
			// Sibling duplicate
			const parent = stack[stack.length - 1]
			const key = `${k.level}|${k.text}`
			const first_index = parent.children_seen.get(key)
			if (first_index !== undefined) {
				const first_target = body_start + first_index
				const first_source = entry.line_map?.[first_target] ?? first_target
				messages.push({
					file: entry.source_name,
					line: source_line + 1,
					severity: 'warning',
					message: `duplicate heading "${k.text}" (also at line ${first_source + 1})`,
				})
			} else {
				parent.children_seen.set(key, i)
			}
			// Ancestor match: walk outward to inward (j=1 is the outermost real frame), report
			// the first match — the root of the duplication chain.
			for (let j = 1; j < stack.length; j++) {
				if (stack[j].text === k.text) {
					const ancestor_target = body_start + stack[j].line
					const ancestor_source = entry.line_map?.[ancestor_target] ?? ancestor_target
					messages.push({
						file: entry.source_name,
						line: source_line + 1,
						severity: 'warning',
						message:
							`heading "${k.text}" duplicates an ancestor `
							+ `(also at line ${ancestor_source + 1})`,
					})
					break
				}
			}
			stack.push({level: k.level, text: k.text, line: i, children_seen: new Map()})
		}
	}
	return messages
}

// * check_no_empty_heading_titles
// Severity: warning.  An ATX heading line whose title is empty after stripping the leading
// hashes (and optional CommonMark trailing-`#` closing sequence) — e.g. `#`, `# `, `##`, or
// `### \t` — is flagged.  Independent of `check_no_empty_sections`: a title-less heading at
// EOF emits BOTH warnings (no title AND empty section); a title-less heading followed by
// content emits only this one.
function check_no_empty_heading_titles(manifest: Manifest): LintMessage[] {
	const messages: LintMessage[] = []
	for (const entry of manifest) {
		if (typeof entry.target_content !== 'string') {
			continue
		}
		const body_start = get_body_start_line(entry)
		const lines = entry.target_content.split('\n')
		const kinds = classify_lines(lines.slice(body_start))
		for (let i = 0; i < kinds.length; i++) {
			const k = kinds[i]
			if (k.kind !== 'heading') {
				continue
			}
			if (k.text !== '') {
				continue
			}
			const target_line = body_start + i
			const source_line = entry.line_map?.[target_line] ?? target_line
			messages.push({
				file: entry.source_name,
				line: source_line + 1,
				severity: 'warning',
				message: 'empty heading title',
			})
		}
	}
	return messages
}

// * check_no_skipped_heading_levels
// Severity: warning.  Flags a heading whose level is more than one greater than the most
// recent heading's level (regardless of branch in the hierarchy).  Empty-titled headings
// are NOT transparent: a `###` line is a level-3 heading whether or not it has text, and
// reporting the skip on the actual offending line (rather than on the next titled heading)
// keeps the diagnosis stable as the author adds/removes titles.  The "first heading in
// body is deeper than level 1" case gets distinct phrasing because there is no real
// predecessor.  Multi-level skips report a compact range (`2-4`); single skips report a
// single number (`2`).
function check_no_skipped_heading_levels(manifest: Manifest): LintMessage[] {
	const messages: LintMessage[] = []
	for (const entry of manifest) {
		if (typeof entry.target_content !== 'string') {
			continue
		}
		const body_start = get_body_start_line(entry)
		const lines = entry.target_content.split('\n')
		const kinds = classify_lines(lines.slice(body_start))
		let prev_level = 0
		for (let i = 0; i < kinds.length; i++) {
			const k = kinds[i]
			if (k.kind !== 'heading') {
				continue
			}
			const target_line = body_start + i
			const source_line = entry.line_map?.[target_line] ?? target_line
			if (prev_level === 0 && k.level > 1) {
				messages.push({
					file: entry.source_name,
					line: source_line + 1,
					severity: 'warning',
					message: `first heading is level ${k.level}, expected level 1`,
				})
			} else if (k.level > prev_level + 1) {
				const skip_start = prev_level + 1
				const skip_end = k.level - 1
				const range = skip_start === skip_end
					? String(skip_start)
					: `${skip_start}-${skip_end}`
				messages.push({
					file: entry.source_name,
					line: source_line + 1,
					severity: 'warning',
					message:
						`heading level ${k.level} follows level ${prev_level}, `
						+ `skipping ${range}`,
				})
			}
			prev_level = k.level
		}
	}
	return messages
}

// * check_no_empty_files
// Severity: warning.  Flags any non-SKILL.md entry whose target_content is empty (a string
// that trims to empty, or a zero-length Buffer).  SKILL.md is handled by `check_empty_body`,
// which reports a per-line location.  No text/binary distinction: a 0-byte file is content-
// free regardless of extension, and no legitimate skill ships an empty image/font/asset.
function check_no_empty_files(manifest: Manifest): LintMessage[] {
	const messages: LintMessage[] = []
	for (const entry of manifest) {
		if (entry.target_name === 'SKILL.md') {
			continue
		}
		const is_empty = typeof entry.target_content === 'string'
			? entry.target_content.trim() === ''
			: entry.target_content.length === 0
		if (!is_empty) {
			continue
		}
		messages.push({
			file: entry.source_name,
			line: 0,
			severity: 'warning',
			message: 'file is empty',
		})
	}
	return messages
}

// * check_empty_body
// Severity: warning.  Body is everything after `body_start_line` — the same region
// `check_no_empty_sections` inspects.  Runs regardless of frontmatter health: a file with
// malformed frontmatter AND no body has two independent issues, both worth reporting.
// Reported line is the first line where the body would begin (translated via line_map for
// .source.md); past EOF when frontmatter is unclosed, which is intentional — it points the
// author to where the body should be.
function check_empty_body(entry: ManifestEntry): LintMessage[] {
	const target = entry.target_content as string
	const body_start = get_body_start_line(entry)
	const lines = target.split('\n')
	const body = lines.slice(body_start).join('\n')
	if (body.trim() !== '') {
		return []
	}
	const source_line = entry.line_map?.[body_start] ?? body_start
	return [{
		file: entry.source_name,
		line: source_line + 1,
		severity: 'warning',
		message: 'body is empty',
	}]
}

// * check_frontmatter
const FRONTMATTER_SPEC_URL = 'https://agentskills.io/specification#frontmatter'

function with_spec_ref(message: string): string {
	return `${message} (see ${FRONTMATTER_SPEC_URL})`
}

function check_frontmatter(entry: ManifestEntry, skill_dir_name: string): LintMessage[] {
	// Caller filters for SKILL.md, whose target_content is always a string (manifest.ts
	// reads .md files as utf8).
	const result = extract_frontmatter(entry.target_content as string)
	if (result.kind === 'none') {
		return [{
			file: entry.source_name,
			line: 0,
			severity: 'error',
			message: with_spec_ref(`${entry.source_name} has no frontmatter`),
		}]
	}
	if (result.kind === 'error') {
		return [{
			file: entry.source_name,
			line: 0,
			severity: 'error',
			message: with_spec_ref(`frontmatter error: ${result.message}`),
		}]
	}
	const issues = validate_frontmatter(result.fields, result.field_lines, skill_dir_name)
	return issues.map(issue => ({
		file: entry.source_name,
		line: issue.line,
		severity: issue.severity,
		message: with_spec_ref(issue.message),
	}))
}

// * lint_manifest
function lint_manifest(skill_dir: string, manifest: Manifest): LintMessage[] {
	const skill_dir_name = basename(skill_dir)
	const skill_md_entry = manifest.find(e => e.target_name === 'SKILL.md')
	return [
		...check_skill_md_exists(skill_dir, manifest),
		...check_no_conflicts(skill_dir, manifest),
		...check_no_unclosed_comments(manifest),
		...check_no_unclosed_fences(manifest),
		...check_no_empty_sections(manifest),
		...check_no_empty_heading_titles(manifest),
		...check_no_duplicate_headings(manifest),
		...check_no_skipped_heading_levels(manifest),
		...check_no_empty_files(manifest),
		...(skill_md_entry != null ? check_frontmatter(skill_md_entry, skill_dir_name) : []),
		...(skill_md_entry != null ? check_empty_body(skill_md_entry) : []),
	]
}

// * lint
export async function lint(skill_dir: string, source: ManifestSource): Promise<void> {
	let manifest: Manifest
	try {
		manifest = await build_manifest(skill_dir, source)
	} catch (e: unknown) {
		console.error(`Error: ${(e as Error).message}`)
		process.exit(1)
	}
	const messages = lint_manifest(skill_dir, manifest)
	for (const msg of messages) {
		console.log(format_lint_message(msg))
	}
	const is_clean = messages.every(m => m.severity !== 'error')
	if (!is_clean) {
		process.exit(1)
	}
}
