#!/usr/bin/env -S node --experimental-strip-types

// * Imports
import {mkdir, readFile, readdir, stat, writeFile} from 'node:fs/promises'
import {resolve, basename} from 'node:path'
import {homedir} from 'node:os'
import {parseArgs} from 'node:util'
import {config as dotenv_config} from 'dotenv'
import {strip_html_comments} from './strip-html-comments.ts'
import {find_target_conflicts} from './manifest.ts'

// * Commands

// ** main
async function main(): Promise<void> {
	const {positionals, values} = parseArgs({
		args: process.argv.slice(2),
		allowPositionals: true,
		options: {
			'comments': {type: 'boolean'},
			'no-comments': {type: 'boolean'},
		},
	})

	const [command, skill_dir_arg] = positionals

	if (!command) {
		console.error('Usage: skill-shed <command> [skill-dir]')
		console.error('Commands: init, deploy')
		process.exit(1)
	}

	const skill_dir = skill_dir_arg ? resolve(skill_dir_arg) : process.cwd()

	if (values.comments && values['no-comments']) {
		console.error('Error: --comments and --no-comments are mutually exclusive')
		process.exit(1)
	}
	const comments_mode = values.comments ? true : values['no-comments'] ? false : null

	if (command === 'init') {
		await init(skill_dir, positionals[2], comments_mode)
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
async function init(skill_dir: string, deploy_dir_arg?: string, comments_mode: boolean | null = null): Promise<void> {
	const skill_name = basename(skill_dir)
	const deploy_dir = deploy_dir_arg
		? resolve(deploy_dir_arg)
		: resolve(homedir(), '.claude', 'skills', skill_name)

	await mkdir(skill_dir, {recursive: true})

	const existing = new Set((await readdir(skill_dir)).sort())

	const conflicts = find_target_conflicts([...existing])
	if (conflicts.length > 0) {
		const conflict_list = conflicts.map(group => group.join(', ')).join('; ')
		console.error(`Error: conflicting files in ${skill_dir}: ${conflict_list}`)
		process.exit(1)
	}

	if (existing.has('.env')) {
		console.error(`Error: .env already exists in ${skill_dir}`)
		process.exit(1)
	}

	const is_skill_md_present = existing.has('SKILL.md')
	const is_skill_source_md_present = existing.has('SKILL.source.md')
	const is_skill_file_present = is_skill_md_present || is_skill_source_md_present

	if (is_skill_source_md_present) {
		if (comments_mode === false) {
			console.error(`Error: cannot initialize SKILL.md when SKILL.source.md is present`)
			process.exit(1)
		}
		console.log(`SKILL.source.md already exists`)
	} else if (is_skill_md_present) {
		if (comments_mode === true) {
			console.error(`Error: cannot initialize SKILL.source.md when SKILL.md is present`)
			process.exit(1)
		}
		console.log(`SKILL.md already exists`)
	}

	await writeFile(resolve(skill_dir, '.env'), `TARGET_DIRECTORY=${deploy_dir}\n`)

	if (!is_skill_file_present) {
		const new_skill_path = resolve(
			skill_dir,
			(comments_mode ?? true) ? 'SKILL.source.md' : 'SKILL.md',
		)
		const template_path = resolve(import.meta.dirname, 'SKILL.template.md')
		const template = await readFile(template_path, 'utf8')
		const substituted = template
			.replace('{{name}}', skill_name)
			.replace('{{Name}}', skill_name.charAt(0).toUpperCase() + skill_name.slice(1))
		const should_strip_comments = !(comments_mode ?? true)
		const skill_content = should_strip_comments ? strip_html_comments(substituted) : substituted
		await writeFile(new_skill_path, skill_content)
	}

	console.log(`Initialized ${skill_dir}`)
	console.log(`TARGET_DIRECTORY=${deploy_dir}`)
}

// ** deploy
async function deploy(skill_dir: string): Promise<void> {
	const env_path = resolve(skill_dir, '.env')

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

	// NOTE: Single-file deploy only.  Multi-file deploy will replace this
	// with a git-ls-files-based manifest and iterate over all source files.
	const skill_source_md_path = resolve(skill_dir, 'SKILL.source.md')
	const skill_md_path = resolve(skill_dir, 'SKILL.md')

	const existing = new Set(await readdir(skill_dir))
	const is_source_md_present = existing.has('SKILL.source.md')
	const is_md_present = existing.has('SKILL.md')

	let source_path: string
	let should_strip_comments: boolean

	if (is_source_md_present && is_md_present) {
		console.error(`Error: both SKILL.source.md and SKILL.md found in ${skill_dir}`)
		process.exit(1)
	} else if (is_source_md_present) {
		source_path = skill_source_md_path
		should_strip_comments = true
	} else if (is_md_present) {
		source_path = skill_md_path
		should_strip_comments = false
	} else {
		console.error(`Error: no SKILL.md or SKILL.source.md found in ${skill_dir}`)
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
		const source_mtime = (await stat(source_path)).mtimeMs
		if (target_mtime > source_mtime) {
			console.error(
				`Error: target ${target_path} is newer than source ${source_path}.\n`
				+ `Target may have been edited directly. Aborting.`,
			)
			process.exit(1)
		}
	}

	await mkdir(resolve(skill_dir, target_dir), {recursive: true})
	let content = await readFile(source_path, 'utf8')
	if (should_strip_comments) {
		content = strip_html_comments(content)
	}
	await writeFile(target_path, content)
	console.log(`Deployed: ${source_path} -> ${target_path}`)
}
