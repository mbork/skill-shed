#!/usr/bin/env -S node --experimental-strip-types

// * Imports
import {resolve} from 'node:path'
import {parseArgs} from 'node:util'
import {init} from './init.ts'
import {deploy} from './deploy.ts'
import {help_and_exit} from './help.ts'

// * handle_help_flag
function handle_help_flag(raw_args: string[]): void {
	// lightweight parsing of arguments is enough here
	const positionals = raw_args.filter(a => !a.startsWith('-'))
	help_and_exit(positionals[0])
}

// * parse_args
function parse_args(raw_args: string[]): {
	command: string
	second_arg: string | undefined
	third_arg: string | undefined
	comments_mode: boolean | null
} {
	const {positionals, values} = parseArgs({
		args: raw_args,
		allowPositionals: true,
		options: {
			'comments': {type: 'boolean'},
			'no-comments': {type: 'boolean'},
		},
	})

	const [command, second_arg, third_arg] = positionals

	if (!command) {
		help_and_exit(undefined)
	}

	if (values.comments && values['no-comments']) {
		console.error('Error: --comments and --no-comments are mutually exclusive')
		process.exit(1)
	}
	const comments_mode = values.comments ? true : values['no-comments'] ? false : null

	return {command, second_arg, third_arg, comments_mode}
}

// * dispatch
async function dispatch(
	command: string,
	second_arg: string | undefined,
	third_arg: string | undefined,
	comments_mode: boolean | null,
): Promise<void> {
	if (command === 'help') {
		help_and_exit(second_arg)
	}

	const skill_dir = second_arg ? resolve(second_arg) : process.cwd()

	if (command === 'init') {
		await init(skill_dir, third_arg, comments_mode)
	} else if (command === 'deploy') {
		await deploy(skill_dir)
	} else {
		help_and_exit(command)
	}
}

// * main
async function main(): Promise<void> {
	const raw_args = process.argv.slice(2)

	const is_help_flag = raw_args.includes('--help') || raw_args.includes('-h')
	if (is_help_flag) {
		handle_help_flag(raw_args)
	}

	const {command, second_arg, third_arg, comments_mode} = parse_args(raw_args)
	await dispatch(command, second_arg, third_arg, comments_mode)
}

if (import.meta.main) {
	await main()
}
