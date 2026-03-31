// * Imports
import {mkdir, readFile, stat, unlink, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {parseEnv} from 'node:util'
import {build_manifest_from_dir, validate_manifest} from './manifest.ts'
import {collect_overwrite_violations, collect_stale_violations, find_stale_names, hash_content, read_sidecar, write_sidecar} from './sidecar.ts'

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

// * read_target_dir
async function read_target_dir(skill_dir: string): Promise<string> {
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

	const target_dir = env.TARGET_DIRECTORY
	if (!target_dir) {
		console.error('Error: TARGET_DIRECTORY not set in .env')
		process.exit(1)
	}

	return resolve(skill_dir, target_dir)
}

// * deploy
export async function deploy(skill_dir: string, is_force = false): Promise<void> {
	const absolute_target_dir = await read_target_dir(skill_dir)

	const manifest = await build_manifest_from_dir(skill_dir)

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
	const stale_violations = await collect_stale_violations(stale_names, absolute_target_dir, existing_sidecar)
	const overwrite_violations = await collect_overwrite_violations(manifest, absolute_target_dir, existing_sidecar)
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
