// * Imports
import {mkdir, readFile, stat, unlink, writeFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'
import {parseEnv, promisify} from 'node:util'
import {execFile as execFile_cb} from 'node:child_process'
import {
	build_manifest_from_command,
	build_manifest_from_git_clean,
	build_manifest_from_git_workdir,
	build_manifest_from_git_staged,
	build_manifest_from_git_ref,
	validate_manifest,
	type Manifest,
} from './manifest.ts'
import {expand_tilde} from './utils.ts'

const execFile = promisify(execFile_cb)
import {
	collect_overwrite_violations,
	collect_stale_violations,
	find_stale_names,
	hash_content,
	read_sidecar,
	write_sidecar,
} from './sidecar.ts'

// * ManifestSource
export type ManifestSource
	= | {kind: 'clean'}
		| {kind: 'workdir'}
		| {kind: 'staged'}
		| {kind: 'ref', ref: string}
		| {kind: 'command', command: string}

// * Sentinel
const SENTINEL_FILENAME = '.skill-shed-deploy-in-progress'

async function write_sentinel(target_dir: string): Promise<void> {
	const sentinel_path = resolve(target_dir, SENTINEL_FILENAME)
	await writeFile(sentinel_path, '')
}

async function delete_sentinel(target_dir: string): Promise<void> {
	await unlink(resolve(target_dir, SENTINEL_FILENAME))
}

async function has_sentinel(target_dir: string): Promise<boolean> {
	const sentinel_path = resolve(target_dir, SENTINEL_FILENAME)
	try {
		await stat(sentinel_path)
		return true
	} catch (e: unknown) {
		const err = e as NodeJS.ErrnoException
		if (err.code === 'ENOENT') {
			return false
		}
		throw e
	}
}

// * read_skill_env
async function read_skill_env(skill_dir: string): Promise<{
	absolute_target_dir: string
	manifest_command: string | undefined
}> {
	const env_path = resolve(skill_dir, '.env')

	let env_content: string
	try {
		env_content = await readFile(env_path, 'utf8')
	} catch (e: unknown) {
		const err = e as NodeJS.ErrnoException
		if (err.code === 'ENOENT') {
			console.error(`Error: no .env file found in ${skill_dir}, run \`skill-shed init\``)
		} else {
			console.error(`Error reading .env: ${err.message}`)
		}
		process.exit(1)
	}
	const env = parseEnv(env_content)

	const target_dir = expand_tilde(env.TARGET_DIRECTORY ?? '')
	if (!target_dir) {
		console.error('Error: TARGET_DIRECTORY not set in .env')
		process.exit(1)
	}

	return {
		absolute_target_dir: resolve(skill_dir, target_dir),
		manifest_command: env.MANIFEST_COMMAND,
	}
}

// * detect_git
async function detect_git(dir: string): Promise<'no-git' | 'no-repo' | 'ok'> {
	try {
		await execFile('git', ['rev-parse', '--is-inside-work-tree'], {cwd: dir})
		return 'ok'
	} catch (e: unknown) {
		const err = e as NodeJS.ErrnoException & {stderr?: string}
		if (err.code === 'ENOENT') {
			return 'no-git'
		}
		if (err.stderr?.includes('not a git repository')) {
			return 'no-repo'
		}
		throw e
	}
}

// * deploy
export async function deploy(
	skill_dir: string,
	is_force = false,
	command_line_source: ManifestSource = {kind: 'clean'},
): Promise<void> {
	const {absolute_target_dir, manifest_command} = await read_skill_env(skill_dir)

	const manifest_source: ManifestSource = manifest_command
		? {kind: 'command', command: manifest_command}
		: command_line_source

	let manifest: Manifest = []
	try {
		if (manifest_source.kind === 'command') {
			manifest = await build_manifest_from_command(skill_dir, manifest_source.command)
		} else {
			const git_status = await detect_git(skill_dir)
			if (git_status === 'no-git') {
				console.error(
					'Error: git not found; install git and run `git init`,'
					+ ' or set MANIFEST_COMMAND in .env',
				)
				process.exit(1)
			}
			if (git_status === 'no-repo') {
				console.error(
					'Error: not a git repository; run `git init` or set MANIFEST_COMMAND in .env',
				)
				process.exit(1)
			}
			if (manifest_source.kind === 'workdir') {
				manifest = await build_manifest_from_git_workdir(skill_dir)
			} else if (manifest_source.kind === 'staged') {
				manifest = await build_manifest_from_git_staged(skill_dir)
			} else if (manifest_source.kind === 'ref') {
				manifest = await build_manifest_from_git_ref(skill_dir, manifest_source.ref)
			} else if (manifest_source.kind === 'clean') {
				manifest = await build_manifest_from_git_clean(skill_dir)
			} else {
				const kind = (manifest_source as {kind: string}).kind
				console.error(`Error: unhandled manifest source kind: ${kind}`)
				process.exit(1)
			}
		}
	} catch (e: unknown) {
		console.error(`Error: ${(e as Error).message}`)
		process.exit(1)
	}

	try {
		validate_manifest(manifest)
	} catch (e: unknown) {
		console.error(`Error: ${(e as Error).message}`)
		process.exit(1)
	}

	await mkdir(absolute_target_dir, {recursive: true})

	if (await has_sentinel(absolute_target_dir) && !is_force) {
		console.error('Error: interrupted deploy detected; re-run with --force to resume')
		process.exit(1)
	}

	const existing_sidecar = await read_sidecar(absolute_target_dir)

	const stale_names = find_stale_names(manifest, existing_sidecar)
	const stale_violations = await collect_stale_violations(
		stale_names, absolute_target_dir, existing_sidecar,
	)
	const overwrite_violations = await collect_overwrite_violations(
		manifest, absolute_target_dir, existing_sidecar,
	)
	const all_violations = [...stale_violations, ...overwrite_violations]
	if (all_violations.length > 0 && !is_force) {
		for (const v of all_violations) {
			console.error(`Error: ${v}`)
		}
		process.exit(1)
	}

	await write_sentinel(absolute_target_dir)

	for (const entry of manifest) {
		const source_path = resolve(skill_dir, entry.source_name)
		const target_path = resolve(absolute_target_dir, entry.target_name)
		await mkdir(dirname(target_path), {recursive: true})
		await writeFile(target_path, entry.target_content)
		console.log(`Deployed: ${source_path} -> ${target_path}`)
	}

	for (const name of stale_names) {
		const target_path = resolve(absolute_target_dir, name)
		try {
			await unlink(target_path)
			console.log(`Removed stale: ${target_path}`)
		} catch (e: unknown) {
			const err = e as NodeJS.ErrnoException
			if (err.code !== 'ENOENT') {
				throw e
			}
		}
	}

	const new_sidecar = {version: 1, files: {} as Record<string, string>}
	for (const entry of manifest) {
		new_sidecar.files[entry.target_name] = hash_content(entry.target_content)
	}
	await write_sidecar(absolute_target_dir, new_sidecar)
	await delete_sentinel(absolute_target_dir)
}
