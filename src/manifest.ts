// A manifest is an array of ManifestEntry objects, one per file to deploy.
// source_content: string for .md files, Buffer for all others.
// target_content: string for .md targets (always, after any transform), Buffer for binary
// pass-throughs.

// * Imports

import {execFile as execFile_cb} from 'node:child_process'
import {readdir, readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {promisify} from 'node:util'
import {strip_html_comments} from './strip-html-comments.ts'

const execFile = promisify(execFile_cb)

// * Types

export interface ManifestEntry {
	source_name: string
	target_name: string
	source_content: string | Buffer
	target_content: string | Buffer
	line_map?: number[]
}

export type Manifest = ManifestEntry[]

// * target_filename
const SOURCE_SUFFIXES = ['.source.md']

// Build one regex matching any known suffix at end-of-string, e.g. /(?:\.source\.md)$/
const SOURCE_SUFFIX_RE = new RegExp(`(?:${SOURCE_SUFFIXES.map(s => RegExp.escape(s)).join('|')})$`)

export function target_filename(source: string): string {
	return source.replace(SOURCE_SUFFIX_RE, '.md')
}

// * make_manifest_entry
function make_manifest_entry(source_name: string, buffer: Buffer): ManifestEntry {
	const source_content = source_name.endsWith('.md') ? buffer.toString('utf8') : buffer
	const target_name = target_filename(source_name)
	const target_content = source_name.endsWith('.source.md')
		? strip_html_comments(source_content as string)
		: source_content
	return {source_name, target_name, source_content, target_content}
}

// * find_target_conflicts
// Returns one group per conflicting target: each group lists the source names
// that all resolve to the same target_name.  Returns [] when there are no conflicts.
export function find_target_conflicts(names: string[]): string[][] {
	const by_target = new Map<string, string[]>()
	for (const name of names) {
		const target = target_filename(name)
		const group = by_target.get(target) ?? []
		group.push(name)
		by_target.set(target, group)
	}
	return [...by_target.values()].filter(group => group.length > 1)
}

// * validate_manifest
// Throws if any two entries share the same target_name, or if no entry targets SKILL.md.
export function validate_manifest(manifest: Manifest): void {
	const conflicts = find_target_conflicts(manifest.map(e => e.source_name))
	if (conflicts.length > 0) {
		const conflict_list = conflicts.map(group => group.join(', ')).join('; ')
		throw new Error(`Conflicting files: ${conflict_list}`)
	}
	if (!manifest.some(e => e.target_name === 'SKILL.md')) {
		throw new Error('No entry targets SKILL.md')
	}
}

// * build_manifest_from_command
export async function build_manifest_from_command(
	_skill_dir: string,
	_command: string,
): Promise<Manifest> {
	throw new Error('not implemented yet')
}

// * build_manifest_from_git_clean
export async function build_manifest_from_git_clean(skill_dir: string): Promise<Manifest> {
	const status_result = await execFile(
		'git', ['status', '--porcelain', '--', '.'], {cwd: skill_dir},
	)
	if (status_result.stdout.trim() !== '') {
		throw new Error(
			`${skill_dir} has uncommitted changes; use --workdir, --staged, or --ref instead`,
		)
	}
	const ls_result = await execFile('git', ['ls-files'], {cwd: skill_dir})
	const names = ls_result.stdout.split('\n').filter(Boolean).sort()
	const manifest: Manifest = await Promise.all(names.map(async (source_name) => {
		const buffer = await readFile(resolve(skill_dir, source_name))
		return make_manifest_entry(source_name, buffer)
	}))
	return manifest
}

// * build_manifest_from_git_workdir
export async function build_manifest_from_git_workdir(skill_dir: string): Promise<Manifest> {
	// All files committed to HEAD (base set); empty string on no-commit repo
	let ls_tree_result
	try {
		ls_tree_result = await execFile(
			'git', ['ls-tree', '-r', '-z', 'HEAD', '--name-only'], {cwd: skill_dir},
		)
	} catch {
		ls_tree_result = {stdout: ''}
	}
	const names = new Set(ls_tree_result.stdout.split('\0').filter(Boolean))
	// Changes relative to HEAD: staged additions/renames, untracked non-ignored files
	const status_result = await execFile(
		'git', ['status', '--porcelain', '-z', '--', '.'], {cwd: skill_dir},
	)
	const file_tokens = status_result.stdout.split('\0')
	let i = 0
	while (i < file_tokens.length) {
		const token = file_tokens[i]
		if (!token) {
			i++
			continue
		}
		const x = token[0]
		const filename = token.slice(3)
		if (x === '?' || x === 'A') {
			// y === 'D' (staged add + deleted from disk) handled by ENOENT below
			names.add(filename)
		} else if (x === 'R' || x === 'C') {
			names.add(filename)
			i++ // consume old-name token; ENOENT handles old file being gone from disk
		}
		// other statuses: file already in names from ls-tree, or deleted from disk (ENOENT)
		i++
	}
	const sorted_names = [...names].sort()
	const entries = await Promise.all(sorted_names.map(async (source_name) => {
		const full_path = resolve(skill_dir, source_name)
		let buffer: Buffer
		try {
			buffer = await readFile(full_path)
		} catch (e: unknown) {
			const code = (e as NodeJS.ErrnoException).code
			if (code === 'ENOENT' || code === 'EISDIR') {
				return null // not a readable file (gone from disk, or untracked directory) -- skip
			}
			throw e
		}
		return make_manifest_entry(source_name, buffer)
	}))
	return entries.filter((e): e is ManifestEntry => e !== null)
}

// * build_manifest_from_git_staged
export async function build_manifest_from_git_staged(_skill_dir: string): Promise<Manifest> {
	throw new Error('not implemented yet')
}

// * build_manifest_from_git_ref
export async function build_manifest_from_git_ref(
	_skill_dir: string,
	_ref: string,
): Promise<Manifest> {
	throw new Error('not implemented yet')
}

// * build_manifest_from_dir
export async function build_manifest_from_dir(skill_dir: string): Promise<Manifest> {
	const names = (await readdir(skill_dir)).sort()
	const manifest: Manifest = []
	for (const source_name of names) {
		if (source_name.startsWith('.')) {
			continue
		}
		const buffer = await readFile(resolve(skill_dir, source_name))
		manifest.push(make_manifest_entry(source_name, buffer))
	}
	return manifest
}
