#!/usr/bin/env -S node --experimental-strip-types

// * Imports
import {stat, copyFile, mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {parseArgs} from 'node:util'
import {config as dotenv_config} from 'dotenv'

// * CLI parsing
const {positionals} = parseArgs({
	args: process.argv.slice(2),
	allowPositionals: true,
})

const [command, skill_dir_arg] = positionals

if (!command) {
	console.error('Usage: skill-shed <command> [skill-dir]')
	console.error('Commands: deploy')
	process.exit(1)
}

const skill_dir = skill_dir_arg ? resolve(skill_dir_arg) : process.cwd()

// * Commands

// ** dispatch
if (command === 'deploy') {
	await deploy(skill_dir)
} else {
	console.error(`Unknown command: ${command}`)
	process.exit(1)
}

// ** deploy
async function deploy(skill_dir: string): Promise<void> {
	const env_path = resolve(skill_dir, '.env')
	const skill_md_path = resolve(skill_dir, 'SKILL.md')

	const env_result = dotenv_config({path: env_path})
	if (env_result.error) {
		const err = env_result.error as NodeJS.ErrnoException
		if (err.code === 'ENOENT') {
			console.error(`Error: no .env file found in ${skill_dir}`)
		} else {
			console.error(`Error reading .env: ${err.message}`)
		}
		process.exit(1)
	}

	const target_dir = process.env.TARGET_DIRECTORY
	if (!target_dir) {
		console.error('Error: TARGET_DIRECTORY not set in .env')
		process.exit(1)
	}

	const target_path = resolve(skill_dir, target_dir, 'SKILL.md')

	let target_mtime: number | null = null
	try {
		target_mtime = (await stat(target_path)).mtimeMs
	} catch (e: unknown) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
	}

	if (target_mtime !== null) {
		const source_mtime = (await stat(skill_md_path)).mtimeMs
		if (target_mtime > source_mtime) {
			console.error(
				`Error: target ${target_path} is newer than source ${skill_md_path}.\n`
				+ `Target may have been edited directly. Aborting.`,
			)
			process.exit(1)
		}
	}

	await mkdir(resolve(skill_dir, target_dir), {recursive: true})
	await copyFile(skill_md_path, target_path)
	console.log(`Deployed: ${skill_md_path} -> ${target_path}`)
}
