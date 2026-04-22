// * Imports
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {parseEnv} from 'node:util'
import {ensure_git_or_abort} from './utils.ts'
import {
	build_manifest_from_command,
	build_manifest_from_git_clean,
	build_manifest_from_git_workdir,
	build_manifest_from_git_staged,
	build_manifest_from_git_ref,
	type Manifest,
} from './manifest.ts'
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

// * lint_manifest
function lint_manifest(skill_dir: string, manifest: Manifest): LintMessage[] {
	return [
		...check_skill_md_exists(skill_dir, manifest),
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
	const manifest = await build_lint_manifest(skill_dir, source)
	const messages = lint_manifest(skill_dir, manifest)
	for (const msg of messages) {
		console.log(format_lint_message(msg))
	}
	const is_clean = messages.every(m => m.severity !== 'error')
	if (!is_clean) {
		process.exit(1)
	}
}
