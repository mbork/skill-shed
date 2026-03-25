#!/usr/bin/env -S node --experimental-strip-types

// * Imports
import {stat, copyFile, mkdir, readFile, writeFile} from 'node:fs/promises'
import {resolve, basename} from 'node:path'
import {homedir} from 'node:os'
import {parseArgs} from 'node:util'
import {config as dotenv_config} from 'dotenv'

// * Commands

// ** main
async function main(): Promise<void> {
	const {positionals} = parseArgs({
		args: process.argv.slice(2),
		allowPositionals: true,
	})

	const [command, skill_dir_arg] = positionals

	if (!command) {
		console.error('Usage: skill-shed <command> [skill-dir]')
		console.error('Commands: init, deploy')
		process.exit(1)
	}

	const skill_dir = skill_dir_arg ? resolve(skill_dir_arg) : process.cwd()

	if (command === 'init') {
		await init(skill_dir, positionals[2])
	} else if (command === 'deploy') {
		await deploy(skill_dir)
	} else {
		console.error(`Unknown command: ${command}`)
		process.exit(1)
	}
}

if (import.meta.main) {
	await main()
}

// ** init
async function init(skill_dir: string, deploy_dir_arg?: string): Promise<void> {
	const skill_name = basename(skill_dir)
	const deploy_dir = deploy_dir_arg
		? resolve(deploy_dir_arg)
		: resolve(homedir(), '.claude', 'skills', skill_name)
	const env_path = resolve(skill_dir, '.env')

	// Here the logic of `try ... catch ...` is reversed compared to the usual case: file existing
	// is an error condition.
	try {
		await stat(env_path)
		console.error(`Error: .env already exists in ${skill_dir}`)
		process.exit(1)
	} catch (e: unknown) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw e
		}
	}

	await mkdir(skill_dir, {recursive: true})
	await writeFile(env_path, `TARGET_DIRECTORY=${deploy_dir}\n`)

	const skill_md_path = resolve(skill_dir, 'SKILL.md')
	let skill_md_exists = false
	try {
		await stat(skill_md_path)
		skill_md_exists = true
	} catch (e: unknown) {
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw e
		}
	}
	if (!skill_md_exists) {
		const template_path = resolve(import.meta.dirname, 'SKILL.template.md')
		const template = await readFile(template_path, 'utf8')
		const skill_md = template
			.replace('{{name}}', skill_name)
			.replace('{{Name}}', skill_name.charAt(0).toUpperCase() + skill_name.slice(1))
		await writeFile(skill_md_path, skill_md)
	}

	console.log(`Initialized ${skill_dir}`)
	console.log(`TARGET_DIRECTORY=${deploy_dir}`)
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
		if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
			throw e
		}
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
