// A manifest is an array of ManifestEntry objects, one per file to deploy.
// source_content: string for .md files, Buffer for all others.
// target_content: string for .md targets (always, after any transform), Buffer for binary
// pass-throughs.

// * Imports

import {execFile as execFile_cb} from 'node:child_process'
import {readdir, readFile} from 'node:fs/promises'
import {normalize, relative, resolve} from 'node:path'
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
// @ts-expect-error RegExp.escape is a Stage 3 proposal, not yet in any TypeScript lib
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
	skill_dir: string,
	command: string,
): Promise<Manifest> {
	let result
	try {
		result = await execFile('/bin/sh', ['-c', command], {cwd: skill_dir})
	} catch (e: unknown) {
		const err = e as {stderr?: string, message: string}
		throw new Error(`MANIFEST_COMMAND failed: ${err.stderr?.trim() || err.message}`)
	}
	const names = result.stdout
		.split('\n')
		.filter(Boolean)
		.map(n => normalize(n))
		.sort()
	const manifest: Manifest = await Promise.all(names.map(async (source_name) => {
		const buffer = await readFile(resolve(skill_dir, source_name))
		return make_manifest_entry(source_name, buffer)
	}))
	return manifest
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
	const git_root
		= (await execFile('git', ['rev-parse', '--show-toplevel'], {cwd: skill_dir})).stdout.trim()
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
		'git',
		['status', '--porcelain', '-z', '--untracked-files=all', '--', '.'],
		{cwd: skill_dir},
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
		const filename = relative(skill_dir, resolve(git_root, token.slice(3)))
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
export async function build_manifest_from_git_staged(skill_dir: string): Promise<Manifest> {
	// All files currently in the index (committed base + staged changes)
	const ls_result = await execFile('git', ['ls-files', '--stage', '-z'], {cwd: skill_dir})
	const raw_entries = ls_result.stdout.split('\0').filter(Boolean)
	const entries = raw_entries.map((entry) => {
		const match = entry.match(/^\S+ (\S+) (\d+)\t(.+)$/s)
		if (!match) {
			throw new Error(`unexpected git ls-files output: ${entry}`)
		}
		const [, hash, stage, source_name] = match
		return {hash, stage, source_name}
	})
	if (entries.some(e => e.stage !== '0')) {
		throw new Error(`conflicts in index in ${skill_dir}: resolve conflicts before deploying`)
	}
	// Abort if nothing staged relative to HEAD; for commit-less repos, abort if index is empty
	let has_head
	try {
		await execFile('git', ['rev-parse', 'HEAD'], {cwd: skill_dir})
		has_head = true
	} catch {
		has_head = false
	}
	if (has_head) {
		const diff_result = await execFile(
			'git', ['diff-index', '--cached', '-z', 'HEAD', '--', '.'], {cwd: skill_dir},
		)
		if (!diff_result.stdout.trim()) {
			throw new Error(`nothing staged in ${skill_dir}`)
		}
	} else if (entries.length === 0) {
		throw new Error(`nothing staged in ${skill_dir}`)
	}
	const sorted_entries = entries.toSorted(
		(a, b) => (a.source_name < b.source_name ? -1 : a.source_name > b.source_name ? 1 : 0),
	)
	const manifest: Manifest = await Promise.all(sorted_entries.map(async ({source_name, hash}) => {
		// `any` needed: no `execFile` overload covers `encoding: 'buffer'`
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const cat_result = await (execFile as any)(
			'git', ['cat-file', 'blob', hash], {cwd: skill_dir, encoding: 'buffer'},
		)
		const buffer = cat_result.stdout as Buffer
		return make_manifest_entry(source_name, buffer)
	}))
	return manifest
}

// * build_manifest_from_git_ref
export async function build_manifest_from_git_ref(
	skill_dir: string,
	ref: string,
): Promise<Manifest> {
	let git_root: string
	try {
		git_root = (
			await execFile('git', ['rev-parse', '--show-toplevel'], {cwd: skill_dir})
		).stdout.trim()
	} catch {
		throw new Error(`${skill_dir} is not inside a git repository`)
	}
	// Pathspec relative to repo root; empty string when skill_dir is the repo root
	const skill_prefix = relative(git_root, skill_dir)
	const ls_args = ['ls-tree', '-r', '-z', ref]
	if (skill_prefix) {
		ls_args.push('--', skill_prefix)
	}
	let ls_result
	try {
		// Run from git_root so the pathspec is unambiguously repo-root-relative
		ls_result = await execFile('git', ls_args, {cwd: git_root})
	} catch (e) {
		throw new Error(`Cannot resolve ref '${ref}' in ${skill_dir}: ${(e as Error).message}`)
	}
	const raw_entries = ls_result.stdout.split('\0').filter(Boolean)
	const entries = raw_entries.map((entry) => {
		const match = entry.match(/^\S+ \S+ (\S+)\t(.+)$/s)
		if (!match) {
			throw new Error(`unexpected git ls-tree output: ${entry}`)
		}
		const [, hash, full_name] = match
		// Strip the skill_prefix/ prefix to get source_name relative to skill_dir
		const source_name = skill_prefix ? full_name.slice(skill_prefix.length + 1) : full_name
		return {hash, source_name}
	})
	const sorted_entries = entries.toSorted(
		(a, b) => (a.source_name < b.source_name ? -1 : a.source_name > b.source_name ? 1 : 0),
	)
	const manifest: Manifest = await Promise.all(sorted_entries.map(async ({source_name, hash}) => {
		// `any` needed: no `execFile` overload covers `encoding: 'buffer'`
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const cat_result = await (execFile as any)(
			'git', ['cat-file', 'blob', hash], {cwd: git_root, encoding: 'buffer'},
		)
		const buffer = cat_result.stdout as Buffer
		return make_manifest_entry(source_name, buffer)
	}))
	return manifest
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
