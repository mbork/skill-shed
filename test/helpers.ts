// * Imports
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

export const exec_file = promisify(execFile)
export const script = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'skill-shed.ts')

// * Helpers

export interface Run_result {stdout: string, stderr: string, code: number}

export interface Run_init_options {env?: NodeJS.ProcessEnv}

export async function run_init(skill_dir: string, deploy_dir?: string, flags: string[] = [], options: Run_init_options = {}): Promise<Run_result> {
	const extra_args = deploy_dir ? [deploy_dir] : []
	const env = options.env ?? process.env
	try {
		const result = await exec_file('node', [script, 'init', skill_dir, ...extra_args, ...flags], {env})
		return {stdout: result.stdout, stderr: result.stderr, code: 0}
	} catch (e: unknown) {
		const err = e as {stdout?: string, stderr?: string, code?: number}
		return {stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code ?? 1}
	}
}

export async function setup_git(skill_dir: string): Promise<void> {
	await exec_file('git', ['init', '--initial-branch', 'master'], {cwd: skill_dir})
	await exec_file('git', ['config', '--local', 'user.email', 'test@example.com'], {cwd: skill_dir})
	await exec_file('git', ['config', '--local', 'user.name', 'Test'], {cwd: skill_dir})
	await writeFile(join(skill_dir, '.git', 'info', 'exclude'), '.env\n')
}

export async function git_commit(dir: string): Promise<void> {
	await exec_file('git', ['add', '-A'], {cwd: dir})
	await exec_file('git', ['commit', '--allow-empty', '-m', 'test'], {cwd: dir})
}

export async function run_deploy(skill_dir: string, options: {cwd?: string, flags?: string[]} = {}): Promise<Run_result> {
	const env = {...process.env}
	delete env.TARGET_DIRECTORY
	const flags = options.flags ?? []
	await setup_git(skill_dir)
	await exec_file('git', ['add', '-A'], {cwd: skill_dir})
	await exec_file('git', ['commit', '--allow-empty', '-m', 'test'], {cwd: skill_dir})
	try {
		const result = await exec_file('node', [script, 'deploy', skill_dir, ...flags], {env, cwd: options.cwd})
		return {stdout: result.stdout, stderr: result.stderr, code: 0}
	} catch (e: unknown) {
		const err = e as {stdout?: string, stderr?: string, code?: number}
		return {stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code ?? 1}
	}
}

export async function run_help(...args: string[]): Promise<Run_result> {
	try {
		const result = await exec_file('node', [script, ...args])
		return {stdout: result.stdout, stderr: result.stderr, code: 0}
	} catch (e: unknown) {
		const err = e as {stdout?: string, stderr?: string, code?: number}
		return {stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code ?? 1}
	}
}

export async function run_cli(...args: string[]): Promise<Run_result> {
	try {
		const result = await exec_file('node', [script, ...args])
		return {stdout: result.stdout, stderr: result.stderr, code: 0}
	} catch (e) {
		const err = e as {stdout: string, stderr: string, code: number}
		return {stdout: err.stdout, stderr: err.stderr, code: err.code}
	}
}

export async function make_tmp_dir(): Promise<string> {
	return mkdtemp(join(tmpdir(), 'skill-shed-test-'))
}

// Returns non-comment, non-empty lines joined by newline — for asserting .env content
// without being sensitive to the MANIFEST_COMMAND comment block added by init.
export function strip_env_comments(content: string): string {
	return content
		.split('\n')
		.filter(line => !line.startsWith('#') && line.trim() !== '')
		.join('\n')
}
