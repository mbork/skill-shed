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
import {check_urls} from './check-urls.ts'

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
	// An actionable pointer the reader can follow: a spec URL or a suggested fix.  Never free
	// prose — that belongs in `message`.  Rendered as a trailing `(see ...)` by
	// `format_lint_message`, keeping `message` pure violation text for structured consumers.
	reference?: string
}

// * format_lint_message
export function format_lint_message(msg: LintMessage): string {
	const base = `${msg.file}:${msg.line}: ${msg.severity}: ${msg.message}`
	if (msg.reference === undefined) {
		return base
	}
	return `${base} (see ${msg.reference})`
}

// * report_lint_messages
// Prints each message to the chosen stream and returns whether any was an error, leaving the
// exit decision to the caller.  `lint` prints to stdout (the report is its output); `deploy`
// prints to stderr (diagnostics around its normal stdout deploy log).
export function report_lint_messages(
	messages: LintMessage[],
	stream: 'stdout' | 'stderr',
): boolean {
	let has_errors = false
	for (const msg of messages) {
		const line = format_lint_message(msg)
		if (stream === 'stderr') {
			console.error(line)
		} else {
			console.log(line)
		}
		if (msg.severity === 'error') {
			has_errors = true
		}
	}
	return has_errors
}

// * check_skill_md_exists
export function check_skill_md_exists(skill_dir: string, manifest: Manifest): LintMessage[] {
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

// * Types for parsed lint data

// HeadingInfo carries everything the heading-based checks need: structural data from the
// heading line itself (level, text), a precomputed 1-based source line ready for messages
// (line_map translation already applied), and a precomputed `is_section_empty` flag so the
// "section between this heading and the next at the same or higher level" scan happens once
// per heading, in `extract_headings`, rather than independently in `check_no_empty_sections`.
interface HeadingInfo {
	level: number
	text: string
	source_line: number // 1-based source line, ready for messages
	is_section_empty: boolean
}

interface EntryHeadings {
	entry: ManifestEntry
	headings: HeadingInfo[]
}

// * extract_headings
// Per-entry one-time parsing for the four heading-based checks.  Splits content, locates the
// body region, runs `classify_lines` once, then walks kinds to extract heading info — the
// `line_map` translation and the section-emptiness scan both happen here so checks consume
// self-contained `HeadingInfo` records.
function extract_headings(manifest: Manifest): EntryHeadings[] {
	const result: EntryHeadings[] = []
	for (const entry of manifest) {
		if (typeof entry.target_content !== 'string') {
			continue
		}
		const body_start = get_body_start_line(entry)
		const lines = entry.target_content.split('\n')
		const kinds = classify_lines(lines.slice(body_start))
		const headings: HeadingInfo[] = []
		for (let i = 0; i < kinds.length; i++) {
			const k = kinds[i]
			if (k.kind !== 'heading') {
				continue
			}
			const target_line = body_start + i
			const source_line = (entry.line_map?.[target_line] ?? target_line) + 1
			headings.push({
				level: k.level,
				text: k.text,
				source_line,
				is_section_empty: is_section_empty(kinds, i, k.level),
			})
		}
		result.push({entry, headings})
	}
	return result
}

// * check_no_empty_sections
// Severity: warning.  Runs over target content, so a section consisting only of comments
// stripped from .source.md is reported empty (which is correct: that's what gets deployed).
function check_no_empty_sections(entry_headings: EntryHeadings[]): LintMessage[] {
	const messages: LintMessage[] = []
	for (const {entry, headings} of entry_headings) {
		for (const h of headings) {
			if (!h.is_section_empty) {
				continue
			}
			messages.push({
				file: entry.source_name,
				line: h.source_line,
				severity: 'warning',
				message: `empty section "${h.text}"`,
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
function check_no_duplicate_headings(entry_headings: EntryHeadings[]): LintMessage[] {
	const messages: LintMessage[] = []
	for (const {entry, headings} of entry_headings) {
		// Stack tracks ancestors of the current heading.  The synthetic root frame at level 0
		// holds top-level headings as siblings; each real frame stores the heading's own text
		// and source line for ancestor-match lookup, plus a `children_seen` map of
		// `${level}|${text}` → first-occurrence source line for sibling duplicate detection.
		// The first source line is preserved (not overwritten) so all later duplicates point
		// back to the same first sibling.
		const stack: {
			level: number
			text: string
			source_line: number
			children_seen: Map<string, number>
		}[] = [{level: 0, text: '', source_line: -1, children_seen: new Map()}]
		for (const h of headings) {
			// Empty headings are reported by check_no_empty_heading_titles and never considered
			// duplicates.
			if (h.text === '') {
				continue
			}
			// Unwind frames that aren't proper ancestors of this heading (same or deeper
			// level) so the top becomes its direct parent.
			while (stack[stack.length - 1].level >= h.level) {
				stack.pop()
			}
			// Sibling duplicate
			const parent = stack[stack.length - 1]
			const key = `${h.level}|${h.text}`
			const first_source_line = parent.children_seen.get(key)
			if (first_source_line !== undefined) {
				messages.push({
					file: entry.source_name,
					line: h.source_line,
					severity: 'warning',
					message: `duplicate heading "${h.text}" (also at line ${first_source_line})`,
				})
			} else {
				parent.children_seen.set(key, h.source_line)
			}
			// Ancestor match: walk outward to inward (j=1 is the outermost real frame), report
			// the first match — the root of the duplication chain.
			for (let j = 1; j < stack.length; j++) {
				if (stack[j].text === h.text) {
					messages.push({
						file: entry.source_name,
						line: h.source_line,
						severity: 'warning',
						message:
							`heading "${h.text}" duplicates an ancestor `
							+ `(also at line ${stack[j].source_line})`,
					})
					break
				}
			}
			stack.push({
				level: h.level,
				text: h.text,
				source_line: h.source_line,
				children_seen: new Map(),
			})
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
function check_no_empty_heading_titles(entry_headings: EntryHeadings[]): LintMessage[] {
	const messages: LintMessage[] = []
	for (const {entry, headings} of entry_headings) {
		for (const h of headings) {
			if (h.text !== '') {
				continue
			}
			messages.push({
				file: entry.source_name,
				line: h.source_line,
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
function check_no_skipped_heading_levels(entry_headings: EntryHeadings[]): LintMessage[] {
	const messages: LintMessage[] = []
	for (const {entry, headings} of entry_headings) {
		let prev_level = 0
		for (const h of headings) {
			if (prev_level === 0 && h.level > 1) {
				messages.push({
					file: entry.source_name,
					line: h.source_line,
					severity: 'warning',
					message: `first heading is level ${h.level}, expected level 1`,
				})
			} else if (h.level > prev_level + 1) {
				const skip_start = prev_level + 1
				const skip_end = h.level - 1
				const range = skip_start === skip_end
					? String(skip_start)
					: `${skip_start}-${skip_end}`
				messages.push({
					file: entry.source_name,
					line: h.source_line,
					severity: 'warning',
					message:
						`heading level ${h.level} follows level ${prev_level}, `
						+ `skipping ${range}`,
				})
			}
			prev_level = h.level
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

// * is_file_referenced
// True when `filename` appears in `content` as a standalone token, distinguishing a
// *punctuation* dot (sentence-ending — "see guide.md.") from a *structural* dot (joins more
// filename — "guide.md.bak", a different file).  The pattern is:
//
//   (?<![\w.-]) NAME (?=\.*(?![\w.-]))
//
//   (?<![\w.-])  left boundary: the char before NAME must not be a filename-stem char (word
//                char, `.`, or `-`), so `guide.md` is not matched inside `v2.guide.md` or
//                `old-guide.md`.
//   NAME         the escaped filename (RegExp.escape handles `+`, `.`, etc.).
//   (?=\.*       right boundary lookahead: optionally consume a run of trailing dots — these
//                are punctuation (`.`, `...`) only if what follows is also a boundary...
//        (?![\w.-]))  ...so after the dot-run the next char must not be a filename-stem char
//                (or be end-of-string).  This rejects `guide.md.bak` / `guide.md...bak` (dots
//                resolve into more filename) while accepting `guide.md`, `guide.md.`,
//                `guide.md...`, and `(guide.md)`.
//
// Exported for direct unit testing of the boundary behavior.
export function is_file_referenced(filename: string, content: string): boolean {
	// @ts-expect-error RegExp.escape is a Stage 3 proposal, not yet in any TypeScript lib
	const pattern = `(?<![\\w.-])${RegExp.escape(filename)}(?=\\.*(?![\\w.-]))`
	const reference_re = new RegExp(pattern)
	return reference_re.test(content)
}

// * check_unreferenced_files
// Severity: warning.  Flags every manifest entry not reachable from SKILL.md through a
// chain of filename references.  Reachability is transitive: SKILL.md -> guide.md ->
// details.md keeps details.md even though SKILL.md never names it directly.  Only the
// deployed `target_name` counts (`source_name` is irrelevant: the runtime agent sees
// deployed names, and lint runs over deployed content).  Only string content can
// reference others; binary entries (Buffer `target_content`) are traversal leaves —
// they can be reached but are never scanned for outgoing references.
function check_unreferenced_files(
	manifest: Manifest,
	skill_md_entry: ManifestEntry,
): LintMessage[] {
	const reached = new Set<ManifestEntry>([skill_md_entry])
	const queue: ManifestEntry[] = [skill_md_entry]
	while (queue.length > 0) {
		const current = queue.shift()!
		if (typeof current.target_content !== 'string') {
			continue
		}
		for (const entry of manifest) {
			if (reached.has(entry)) {
				continue
			}
			if (is_file_referenced(entry.target_name, current.target_content)) {
				reached.add(entry)
				queue.push(entry)
			}
		}
	}
	const messages: LintMessage[] = []
	for (const entry of manifest) {
		if (reached.has(entry)) {
			continue
		}
		messages.push({
			file: entry.source_name,
			line: 0,
			severity: 'warning',
			message: 'file not referenced from SKILL.md',
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

// * check_body_length
// Severity: warning.  Caller (lint_manifest) filters for SKILL.md.  Body is everything
// after `body_start_line` — same region check_empty_body and check_no_empty_sections
// inspect.  Length is measured AFTER `.trim()`, mirroring check_empty_body and
// check_no_empty_files: surrounding whitespace (a trailing newline added by the author's
// editor, leading blank lines after the closing `---`) is editor noise, not real body
// content, and the 20000-char threshold is approximate enough (~5000 tokens at 4
// chars/token) that ±10 chars from trim is below the noise floor.  Reported at the first
// body line (translated via line_map for .source.md) — same convention as
// check_empty_body, since this is a body-level concern.
const SKILL_BODY_MAX = 20000
const PROGRESSIVE_DISCLOSURE_URL = 'https://agentskills.io/specification#progressive-disclosure'

function check_body_length(entry: ManifestEntry): LintMessage[] {
	const target = entry.target_content as string
	const body_start = get_body_start_line(entry)
	const lines = target.split('\n')
	const body = lines.slice(body_start).join('\n')
	const trimmed_length = body.trim().length
	if (trimmed_length <= SKILL_BODY_MAX) {
		return []
	}
	const approx_tokens = SKILL_BODY_MAX / 4
	const source_line = entry.line_map?.[body_start] ?? body_start
	return [{
		file: entry.source_name,
		line: source_line + 1,
		severity: 'warning',
		message:
			`body length (${trimmed_length} chars) exceeds the ${SKILL_BODY_MAX}-character `
			+ `recommended maximum (~${approx_tokens} tokens at 4 chars/token)`,
		reference: PROGRESSIVE_DISCLOSURE_URL,
	}]
}

// * check_frontmatter
const FRONTMATTER_SPEC_URL = 'https://agentskills.io/specification#frontmatter'

function check_frontmatter(entry: ManifestEntry, skill_dir_name: string): LintMessage[] {
	// Caller filters for SKILL.md, whose target_content is always a string (manifest.ts
	// reads .md files as utf8).
	const result = extract_frontmatter(entry.target_content as string)
	if (result.kind === 'none') {
		return [{
			file: entry.source_name,
			line: 0,
			severity: 'error',
			message: `${entry.source_name} has no frontmatter`,
			reference: FRONTMATTER_SPEC_URL,
		}]
	}
	if (result.kind === 'error') {
		return [{
			file: entry.source_name,
			line: 0,
			severity: 'error',
			message: `frontmatter error: ${result.message}`,
			reference: FRONTMATTER_SPEC_URL,
		}]
	}
	const issues = validate_frontmatter(result.fields, result.field_lines, skill_dir_name)
	return issues.map(issue => ({
		file: entry.source_name,
		line: issue.line,
		severity: issue.severity,
		message: issue.message,
		reference: FRONTMATTER_SPEC_URL,
	}))
}

// * lint_manifest
export function lint_manifest(skill_dir: string, manifest: Manifest): LintMessage[] {
	const skill_dir_name = basename(skill_dir)
	const skill_md_entry = manifest.find(e => e.target_name === 'SKILL.md')
	const entry_headings = extract_headings(manifest)
	return [
		...check_skill_md_exists(skill_dir, manifest),
		...check_no_conflicts(skill_dir, manifest),
		...check_no_unclosed_comments(manifest),
		...check_no_unclosed_fences(manifest),
		...check_no_empty_sections(entry_headings),
		...check_no_empty_heading_titles(entry_headings),
		...check_no_duplicate_headings(entry_headings),
		...check_no_skipped_heading_levels(entry_headings),
		...check_no_empty_files(manifest),
		...(skill_md_entry != null ? check_unreferenced_files(manifest, skill_md_entry) : []),
		...(skill_md_entry != null ? check_frontmatter(skill_md_entry, skill_dir_name) : []),
		...(skill_md_entry != null ? check_empty_body(skill_md_entry) : []),
		...(skill_md_entry != null ? check_body_length(skill_md_entry) : []),
	]
}

// * read_url_timeout
// Per-request timeout (ms) for `--check-urls`, from `SKILL_SHED_URL_TIMEOUT_MS` (tests set a small
// value).  Falls back to the default when the variable is unset, non-numeric, or non-positive.
// Exported for direct unit testing of those fallback branches (deterministic process.env control).
const URL_TIMEOUT_DEFAULT_MS = 10000

export function read_url_timeout(): number {
	const parsed = Number(process.env.SKILL_SHED_URL_TIMEOUT_MS)
	if (Number.isFinite(parsed) && parsed > 0) {
		return parsed
	}
	return URL_TIMEOUT_DEFAULT_MS
}

// * lint
// `is_check_urls` (the `--check-urls` flag) is lint-only: when set, every http(s) URL in the
// manifest is probed over the network and any non-OK result is appended as a warning.  URL checks
// only ever produce warnings, so they never change the error-based exit code.
export async function lint(
	skill_dir: string,
	source: ManifestSource,
	options: {is_check_urls: boolean},
): Promise<void> {
	let manifest: Manifest
	try {
		manifest = await build_manifest(skill_dir, source)
	} catch (e: unknown) {
		console.error(`Error: ${(e as Error).message}`)
		process.exit(1)
	}
	const messages = lint_manifest(skill_dir, manifest)
	if (options.is_check_urls) {
		const url_messages = await check_urls(manifest, {timeout_ms: read_url_timeout()})
		messages.push(...url_messages)
	}
	const has_errors = report_lint_messages(messages, 'stdout')
	if (has_errors) {
		process.exit(1)
	}
}
