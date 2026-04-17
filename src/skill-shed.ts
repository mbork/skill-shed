#!/usr/bin/env -S node

// * Imports
import {resolve} from 'node:path'
import {parseArgs} from 'node:util'
import {init} from './init.ts'
import {deploy} from './deploy.ts'
import type {ManifestSource} from './deploy.ts'
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
	is_force: boolean
	command_line_source: ManifestSource
} {
	let parsed
	try {
		parsed = parseArgs({
			args: raw_args,
			allowPositionals: true,
			options: {
				'comments': {type: 'boolean'},
				'no-comments': {type: 'boolean'},
				'force': {type: 'boolean', short: 'f'},
				'clean': {type: 'boolean'},
				'workdir': {type: 'boolean'},
				'staged': {type: 'boolean'},
				'ref': {type: 'string'},
			},
		})
	} catch (err) {
		if (err instanceof Error && 'code' in err
			&& typeof err.code === 'string'
			&& err.code.startsWith('ERR_PARSE_ARGS_')) {
			console.error(`Error: ${err.message}`)
			process.exit(1)
		}
		throw err
	}
	const {positionals, values} = parsed

	const [command, second_arg, third_arg] = positionals

	if (!command) {
		help_and_exit(undefined)
	}

	if (values.comments && values['no-comments']) {
		console.error('Error: --comments and --no-comments are mutually exclusive')
		process.exit(1)
	}
	const comments_mode = values.comments ? true : values['no-comments'] ? false : null
	const is_force = values.force ?? false

	const command_line_source_flags = [
		values.clean, values.workdir, values.staged, values.ref !== undefined,
	]
		.filter(Boolean)
	if (command_line_source_flags.length > 1) {
		console.error('Error: --clean, --workdir, --staged, and --ref are mutually exclusive')
		process.exit(1)
	}
	let command_line_source: ManifestSource = {kind: 'clean'}
	if (values.workdir) {
		command_line_source = {kind: 'workdir'}
	} else if (values.staged) {
		command_line_source = {kind: 'staged'}
	} else if (values.ref !== undefined) {
		command_line_source = {kind: 'ref', ref: values.ref}
	}

	return {command, second_arg, third_arg, comments_mode, is_force, command_line_source}
}

// * dispatch
async function dispatch(
	command: string,
	second_arg: string | undefined,
	third_arg: string | undefined,
	comments_mode: boolean | null,
	is_force: boolean,
	command_line_source: ManifestSource,
): Promise<void> {
	if (command === 'help') {
		help_and_exit(second_arg)
	}

	const skill_dir = second_arg ? resolve(second_arg) : process.cwd()

	if (command === 'init') {
		await init(skill_dir, third_arg, comments_mode)
	} else if (command === 'deploy') {
		await deploy(skill_dir, is_force, command_line_source)
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

	const {
		command, second_arg, third_arg, comments_mode, is_force, command_line_source,
	} = parse_args(raw_args)
	await dispatch(command, second_arg, third_arg, comments_mode, is_force, command_line_source)
}

if (import.meta.main) {
	await main()
}
