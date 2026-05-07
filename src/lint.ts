// * Imports
import {readFile} from 'node:fs/promises'
import {basename, resolve} from 'node:path'
import {parseEnv} from 'node:util'
import {ensure_git_or_abort} from './utils.ts'
import {
	build_manifest_from_command,
	build_manifest_from_git_clean,
	build_manifest_from_git_workdir,
	build_manifest_from_git_staged,
	build_manifest_from_git_ref,
	find_target_conflicts,
	type Manifest,
	type ManifestEntry,
} from './manifest.ts'
import {make_fence_tracker} from './md-parse.ts'
import {extract_frontmatter, validate_frontmatter} from './frontmatter.ts'
import type {ManifestSource} from './deploy.ts'

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

// * check_frontmatter
function check_frontmatter(entry: ManifestEntry, skill_dir_name: string): LintMessage[] {
	if (typeof entry.target_content !== 'string') {
		return []
	}
	const result = extract_frontmatter(entry.target_content)
	if (result.kind === 'none') {
		return [{
			file: entry.source_name,
			line: 0,
			severity: 'error',
			message: `${entry.source_name} has no frontmatter`,
		}]
	}
	if (result.kind === 'error') {
		return [{
			file: entry.source_name,
			line: 0,
			severity: 'error',
			message: `frontmatter error: ${result.message}`,
		}]
	}
	const issues = validate_frontmatter(result.fields, result.field_lines, skill_dir_name)
	return issues.map(issue => ({
		file: entry.source_name,
		line: issue.line,
		severity: issue.severity,
		message: issue.message,
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
		...(skill_md_entry != null ? check_frontmatter(skill_md_entry, skill_dir_name) : []),
	]
}

// * read_manifest_command
async function read_manifest_command(skill_dir: string): Promise<string | undefined> {
	const env_path = resolve(skill_dir, '.env')
	try {
		const content = await readFile(env_path, 'utf8')
		return parseEnv(content).MANIFEST_COMMAND
	} catch (e: unknown) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
			return undefined
		}
		throw e
	}
}

// * build_lint_manifest
async function build_lint_manifest(skill_dir: string, source: ManifestSource): Promise<Manifest> {
	const manifest_command = await read_manifest_command(skill_dir)
	if (manifest_command) {
		return build_manifest_from_command(skill_dir, manifest_command)
	}
	await ensure_git_or_abort(skill_dir)
	if (source.kind === 'clean') {
		return build_manifest_from_git_clean(skill_dir)
	} else if (source.kind === 'workdir') {
		return build_manifest_from_git_workdir(skill_dir)
	} else if (source.kind === 'staged') {
		return build_manifest_from_git_staged(skill_dir)
	} else if (source.kind === 'ref') {
		return build_manifest_from_git_ref(skill_dir, source.ref)
	} else {
		return build_manifest_from_command(skill_dir, source.command)
	}
}

// * lint
export async function lint(skill_dir: string, source: ManifestSource): Promise<void> {
	let manifest
	try {
		manifest = await build_lint_manifest(skill_dir, source)
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
