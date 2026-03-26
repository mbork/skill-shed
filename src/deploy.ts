// * Imports
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {parse as dotenv_parse} from 'dotenv'
import {build_manifest_from_dir, validate_manifest} from './manifest.ts'

// * deploy
export async function deploy(skill_dir: string): Promise<void> {
	const env_path = resolve(skill_dir, '.env')

	let env_content: string
	try {
		env_content = await readFile(env_path, 'utf8')
	} catch (e: unknown) {
		const err = e as NodeJS.ErrnoException
		if (err.code === 'ENOENT') {
			console.error(`Error: no .env file found in ${skill_dir}`)
		} else {
			console.error(`Error reading .env: ${err.message}`)
		}
		process.exit(1)
	}
	const env = dotenv_parse(env_content)

	const target_dir = env.TARGET_DIRECTORY
	if (!target_dir) {
		console.error('Error: TARGET_DIRECTORY not set in .env')
		process.exit(1)
	}

	const manifest = await build_manifest_from_dir(skill_dir)

	try {
		validate_manifest(manifest)
	} catch (e: unknown) {
		console.error(`Error: ${(e as Error).message}`)
		process.exit(1)
	}

	await mkdir(resolve(skill_dir, target_dir), {recursive: true})
	for (const entry of manifest) {
		const source_path = resolve(skill_dir, entry.source_name)
		const target_path = resolve(skill_dir, target_dir, entry.target_name)
		await writeFile(target_path, entry.target_content)
		console.log(`Deployed: ${source_path} -> ${target_path}`)
	}
}
