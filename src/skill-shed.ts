#!/usr/bin/env -S node --experimental-strip-types

// * Imports
import {resolve} from 'node:path'
import {parseArgs} from 'node:util'
import {init} from './init.ts'
import {deploy} from './deploy.ts'

// * main
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
