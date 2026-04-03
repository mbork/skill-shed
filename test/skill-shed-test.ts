#!/usr/bin/env -S node --experimental-strip-types

// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdir, mkdtemp, writeFile, readFile, readdir, rename, stat, unlink} from 'node:fs/promises'
import {tmpdir, homedir} from 'node:os'
import {join, resolve, dirname, basename} from 'node:path'
import {fileURLToPath} from 'node:url'
import {strip_html_comments} from '../src/strip-html-comments.ts'
import {build_manifest_from_dir, build_manifest_from_git_clean, build_manifest_from_git_workdir, validate_manifest, find_target_conflicts, target_filename} from '../src/manifest.ts'
import {load_global_config} from '../src/global-config.ts'
import {find_stale_names, hash_content, SIDECAR_FILENAME} from '../src/sidecar.ts'

const exec_file = promisify(execFile)
const script = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'skill-shed.ts')

// * Helpers

interface Run_result {stdout: string, stderr: string, code: number}

interface Run_init_options {env?: NodeJS.ProcessEnv}

async function run_init(skill_dir: string, deploy_dir?: string, flags: string[] = [], options: Run_init_options = {}): Promise<Run_result> {
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

async function setup_git(skill_dir: string): Promise<void> {
	await exec_file('git', ['init'], {cwd: skill_dir})
	await exec_file('git', ['config', '--local', 'user.email', 'test@example.com'], {cwd: skill_dir})
	await exec_file('git', ['config', '--local', 'user.name', 'Test'], {cwd: skill_dir})
	await writeFile(join(skill_dir, '.git', 'info', 'exclude'), '.env\n')
}

async function git_commit(dir: string): Promise<void> {
	await exec_file('git', ['add', '-A'], {cwd: dir})
	await exec_file('git', ['commit', '--allow-empty', '-m', 'test'], {cwd: dir})
}

async function run_deploy(skill_dir: string, options: {cwd?: string, flags?: string[]} = {}): Promise<Run_result> {
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

async function run_help(...args: string[]): Promise<Run_result> {
	try {
		const result = await exec_file('node', [script, ...args])
		return {stdout: result.stdout, stderr: result.stderr, code: 0}
	} catch (e: unknown) {
		const err = e as {stdout?: string, stderr?: string, code?: number}
		return {stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code ?? 1}
	}
}

async function make_tmp_dir(): Promise<string> {
	return mkdtemp(join(tmpdir(), 'skill-shed-test-'))
}

// Returns non-comment, non-empty lines joined by newline — for asserting .env content
// without being sensitive to the MANIFEST_COMMAND comment block added by init.
function strip_env_comments(content: string): string {
	return content
		.split('\n')
		.filter(line => !line.startsWith('#') && line.trim() !== '')
		.join('\n')
}

// * Tests

// ** Init

const MY_SKILL_SOURCE_CONTENT = [
	'---',
	'name: my-skill',
	'description: >',
	'  What this skill does – generates files?  Executes shell scripts?',
	'  Sends HTTP requests?  When to use it – when the user asks or',
	'  mentions something?  Uploads a file of specific type?  Fill the',
	'  details in here.',
	'allowed-tools: Read, Bash(rg *)',
	'---',
	'',
	'<!-- NOTE: HTML comments are stripped on skill deployment, except',
	'     inside code blocks.  To disable stripping for a file, remove',
	'     `.source` from its name.  For example, to disable stripping',
	'     here, rename this file from `SKILL.source.md` to `SKILL.md`. -->',
	'',
	'# My-skill skill',
].join('\n')

const MY_SKILL_CONTENT = [
	'---',
	'name: my-skill',
	'description: >',
	'  What this skill does – generates files?  Executes shell scripts?',
	'  Sends HTTP requests?  When to use it – when the user asks or',
	'  mentions something?  Uploads a file of specific type?  Fill the',
	'  details in here.',
	'allowed-tools: Read, Bash(rg *)',
	'---',
	'',
	'# My-skill skill',
].join('\n')

test('init: creates skill dir, .env, and SKILL.source.md by default', async () => {
	const parent = await make_tmp_dir()
	const skill_dir = join(parent, 'my-skill')
	const deploy_dir = await make_tmp_dir()

	const result = await run_init(skill_dir, deploy_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stderr.trim(), '')
	assert.strictEqual(result.stdout.trim(), [
		`Initialized ${skill_dir}`,
		`TARGET_DIRECTORY=${deploy_dir}`,
		`.env created in ${skill_dir}, don't forget to add it to .gitignore if you initialize a Git repo later`,
	].join('\n'))
	assert.strictEqual(
		strip_env_comments(await readFile(join(skill_dir, '.env'), 'utf8')),
		`TARGET_DIRECTORY=${deploy_dir}`,
	)
	assert.strictEqual(
		(await readFile(join(skill_dir, 'SKILL.source.md'), 'utf8')).trim(),
		MY_SKILL_SOURCE_CONTENT,
	)
	const files = await readdir(skill_dir)
	assert.deepStrictEqual(files.sort(), ['.env', 'SKILL.source.md'])
})

test('init: --no-comments creates SKILL.md instead', async () => {
	const parent = await make_tmp_dir()
	const skill_dir = join(parent, 'my-skill')
	const deploy_dir = await make_tmp_dir()

	const result = await run_init(skill_dir, deploy_dir, ['--no-comments'])

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stderr.trim(), '')
	assert.strictEqual(result.stdout.trim(), [
		`Initialized ${skill_dir}`,
		`TARGET_DIRECTORY=${deploy_dir}`,
		`.env created in ${skill_dir}, don't forget to add it to .gitignore if you initialize a Git repo later`,
	].join('\n'))
	assert.strictEqual(
		strip_env_comments(await readFile(join(skill_dir, '.env'), 'utf8')),
		`TARGET_DIRECTORY=${deploy_dir}`,
	)
	assert.strictEqual(
		(await readFile(join(skill_dir, 'SKILL.md'), 'utf8')).trim(),
		MY_SKILL_CONTENT,
	)
	const files = await readdir(skill_dir)
	assert.deepStrictEqual(files.sort(), ['.env', 'SKILL.md'])
})

test('init: --comments creates SKILL.source.md', async () => {
	const parent = await make_tmp_dir()
	const skill_dir = join(parent, 'my-skill')
	const deploy_dir = await make_tmp_dir()

	const result = await run_init(skill_dir, deploy_dir, ['--comments'])

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stderr.trim(), '')
	assert.strictEqual(result.stdout.trim(), [
		`Initialized ${skill_dir}`,
		`TARGET_DIRECTORY=${deploy_dir}`,
		`.env created in ${skill_dir}, don't forget to add it to .gitignore if you initialize a Git repo later`,
	].join('\n'))
	assert.strictEqual(
		strip_env_comments(await readFile(join(skill_dir, '.env'), 'utf8')),
		`TARGET_DIRECTORY=${deploy_dir}`,
	)
	assert.strictEqual(
		(await readFile(join(skill_dir, 'SKILL.source.md'), 'utf8')).trim(),
		MY_SKILL_SOURCE_CONTENT,
	)
	const files = await readdir(skill_dir)
	assert.deepStrictEqual(files.sort(), ['.env', 'SKILL.source.md'])
})

test('init: --no-comments aborts when SKILL.source.md is present', async () => {
	const skill_dir = await make_tmp_dir()
	const deploy_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), '# Existing\n')

	const result = await run_init(skill_dir, deploy_dir, ['--no-comments'])

	assert.strictEqual(result.code, 1)
	assert.strictEqual(result.stdout.trim(), '')
	assert.strictEqual(result.stderr.trim(), 'Error: cannot initialize SKILL.md when SKILL.source.md is present')
	assert.deepStrictEqual((await readdir(skill_dir)).sort(), ['SKILL.source.md'])
})

test('init: --comments aborts when SKILL.md is present', async () => {
	const skill_dir = await make_tmp_dir()
	const deploy_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# Existing\n')

	const result = await run_init(skill_dir, deploy_dir, ['--comments'])

	assert.strictEqual(result.code, 1)
	assert.strictEqual(result.stdout.trim(), '')
	assert.strictEqual(result.stderr.trim(), 'Error: cannot initialize SKILL.source.md when SKILL.md is present')
	assert.deepStrictEqual((await readdir(skill_dir)).sort(), ['SKILL.md'])
})

test('init: aborts when both SKILL.md and SKILL.source.md are present', async () => {
	const skill_dir = await make_tmp_dir()
	const deploy_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# A\n')
	await writeFile(join(skill_dir, 'SKILL.source.md'), '# B\n')

	const result = await run_init(skill_dir, deploy_dir)

	assert.strictEqual(result.code, 1)
	assert.strictEqual(result.stdout.trim(), '')
	assert.strictEqual(result.stderr.trim(), `Error: conflicting files in ${skill_dir}: SKILL.md, SKILL.source.md`)
	assert.deepStrictEqual((await readdir(skill_dir)).sort(), ['SKILL.md', 'SKILL.source.md'])
})

test('init: aborts when any two files share a deploy target', async () => {
	const skill_dir = await make_tmp_dir()
	const deploy_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'reference.md'), '# A\n')
	await writeFile(join(skill_dir, 'reference.source.md'), '# B\n')

	const result = await run_init(skill_dir, deploy_dir)

	assert.strictEqual(result.code, 1)
	assert.strictEqual(result.stdout.trim(), '')
	assert.strictEqual(result.stderr.trim(), `Error: conflicting files in ${skill_dir}: reference.md, reference.source.md`)
	assert.deepStrictEqual((await readdir(skill_dir)).sort(), ['reference.md', 'reference.source.md'])
})

test('init: creates .env in existing dir', async () => {
	const skill_dir = await make_tmp_dir()
	const deploy_dir = await make_tmp_dir()
	const skill_md_content = '# My skill\n'
	await writeFile(join(skill_dir, 'SKILL.md'), skill_md_content)

	const result = await run_init(skill_dir, deploy_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stderr.trim(), '')
	assert.strictEqual(result.stdout.trim(), [
		'SKILL.md already exists',
		`Initialized ${skill_dir}`,
		`TARGET_DIRECTORY=${deploy_dir}`,
		`.env created in ${skill_dir}, don't forget to add it to .gitignore if you initialize a Git repo later`,
	].join('\n'))
	assert.strictEqual(
		strip_env_comments(await readFile(join(skill_dir, '.env'), 'utf8')),
		`TARGET_DIRECTORY=${deploy_dir}`,
	)
	assert.strictEqual((await readFile(join(skill_dir, 'SKILL.md'), 'utf8')).trim(), skill_md_content.trim())
	const files = await readdir(skill_dir)
	assert.deepStrictEqual(files.sort(), ['.env', 'SKILL.md'])
})

test('init: default creates .env when SKILL.source.md already exists', async () => {
	const skill_dir = await make_tmp_dir()
	const deploy_dir = await make_tmp_dir()
	const existing_content = '# Existing source\n'
	await writeFile(join(skill_dir, 'SKILL.source.md'), existing_content)

	const result = await run_init(skill_dir, deploy_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stderr.trim(), '')
	assert.strictEqual(result.stdout.trim(), [
		'SKILL.source.md already exists',
		`Initialized ${skill_dir}`,
		`TARGET_DIRECTORY=${deploy_dir}`,
		`.env created in ${skill_dir}, don't forget to add it to .gitignore if you initialize a Git repo later`,
	].join('\n'))
	assert.strictEqual(
		strip_env_comments(await readFile(join(skill_dir, '.env'), 'utf8')),
		`TARGET_DIRECTORY=${deploy_dir}`,
	)
	assert.strictEqual((await readFile(join(skill_dir, 'SKILL.source.md'), 'utf8')).trim(), existing_content.trim())
	assert.deepStrictEqual((await readdir(skill_dir)).sort(), ['.env', 'SKILL.source.md'])
})

test('init: --no-comments creates .env when SKILL.md already exists', async () => {
	const skill_dir = await make_tmp_dir()
	const deploy_dir = await make_tmp_dir()
	const existing_content = '# Existing skill\n'
	await writeFile(join(skill_dir, 'SKILL.md'), existing_content)

	const result = await run_init(skill_dir, deploy_dir, ['--no-comments'])

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stderr.trim(), '')
	assert.strictEqual(result.stdout.trim(), [
		'SKILL.md already exists',
		`Initialized ${skill_dir}`,
		`TARGET_DIRECTORY=${deploy_dir}`,
		`.env created in ${skill_dir}, don't forget to add it to .gitignore if you initialize a Git repo later`,
	].join('\n'))
	assert.strictEqual(
		strip_env_comments(await readFile(join(skill_dir, '.env'), 'utf8')),
		`TARGET_DIRECTORY=${deploy_dir}`,
	)
	assert.strictEqual((await readFile(join(skill_dir, 'SKILL.md'), 'utf8')).trim(), existing_content.trim())
	assert.deepStrictEqual((await readdir(skill_dir)).sort(), ['.env', 'SKILL.md'])
})

test('init: aborts if .env already exists', async () => {
	const skill_dir = await make_tmp_dir()
	const original_env = 'TARGET_DIRECTORY=/some/path\n'
	await writeFile(join(skill_dir, '.env'), original_env)

	const result = await run_init(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.strictEqual(result.stdout.trim(), '')
	assert.strictEqual(result.stderr.trim(), `Error: .env already exists in ${skill_dir}`)
	assert.strictEqual(strip_env_comments(await readFile(join(skill_dir, '.env'), 'utf8')), original_env.trim())
	const files = await readdir(skill_dir)
	assert.deepStrictEqual(files.sort(), ['.env'])
})

test('init: does not create SKILL.md if it already exists', async () => {
	const skill_dir = await make_tmp_dir()
	const deploy_dir = await make_tmp_dir()
	const original = '# Existing skill\n'
	await writeFile(join(skill_dir, 'SKILL.md'), original)

	const result = await run_init(skill_dir, deploy_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stderr.trim(), '')
	assert.strictEqual(result.stdout.trim(), [
		'SKILL.md already exists',
		`Initialized ${skill_dir}`,
		`TARGET_DIRECTORY=${deploy_dir}`,
		`.env created in ${skill_dir}, don't forget to add it to .gitignore if you initialize a Git repo later`,
	].join('\n'))
	assert.strictEqual(
		strip_env_comments(await readFile(join(skill_dir, '.env'), 'utf8')),
		`TARGET_DIRECTORY=${deploy_dir}`,
	)
	assert.strictEqual((await readFile(join(skill_dir, 'SKILL.md'), 'utf8')).trim(), original.trim())
	const files = await readdir(skill_dir)
	assert.deepStrictEqual(files.sort(), ['.env', 'SKILL.md'])
})

test('init: default deploy dir is ~/.claude/skills/<skill-name>', async () => {
	const parent = await make_tmp_dir()
	const skill_dir = join(parent, 'my-skill')

	const result = await run_init(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stderr.trim(), '')
	const expected_deploy_dir = resolve(homedir(), '.claude', 'skills', basename(skill_dir))
	assert.strictEqual(result.stdout.trim(), [
		`Initialized ${skill_dir}`,
		`TARGET_DIRECTORY=${expected_deploy_dir}`,
		`.env created in ${skill_dir}, don't forget to add it to .gitignore if you initialize a Git repo later`,
	].join('\n'))
	assert.strictEqual(
		strip_env_comments(await readFile(join(skill_dir, '.env'), 'utf8')),
		`TARGET_DIRECTORY=${expected_deploy_dir}`,
	)
	assert.strictEqual(
		(await readFile(join(skill_dir, 'SKILL.source.md'), 'utf8')).trim(),
		MY_SKILL_SOURCE_CONTENT,
	)
	const files = await readdir(skill_dir)
	assert.deepStrictEqual(files.sort(), ['.env', 'SKILL.source.md'])
})

test('init: falls back to ~/.claude/skills when global config is absent', async () => {
	const parent = await make_tmp_dir()
	const skill_dir = join(parent, 'my-skill')
	const nonexistent_config = join(await make_tmp_dir(), 'nonexistent.json')
	const env = {...process.env, SKILL_SHED_CONFIG: nonexistent_config}

	const result = await run_init(skill_dir, undefined, [], {env})

	assert.strictEqual(result.code, 0)
	const env_content = await readFile(join(skill_dir, '.env'), 'utf8')
	assert.strictEqual(strip_env_comments(env_content), `TARGET_DIRECTORY=${resolve(homedir(), '.claude', 'skills', 'my-skill')}`)
})

test('init: uses default_target_directory from global config when no deploy_dir given', async () => {
	const parent = await make_tmp_dir()
	const skill_dir = join(parent, 'my-skill')
	const base_dir = await make_tmp_dir()
	const config_file = join(await make_tmp_dir(), 'skill-shed.env')
	await writeFile(config_file, `DEFAULT_TARGET_DIRECTORY=${base_dir}\n`)
	const env = {...process.env, SKILL_SHED_CONFIG: config_file}

	const result = await run_init(skill_dir, undefined, [], {env})

	assert.strictEqual(result.code, 0)
	const env_content = await readFile(join(skill_dir, '.env'), 'utf8')
	assert.strictEqual(strip_env_comments(env_content), `TARGET_DIRECTORY=${join(base_dir, 'my-skill')}`)
})

test('init: explicit deploy_dir overrides global config', async () => {
	const parent = await make_tmp_dir()
	const skill_dir = join(parent, 'my-skill')
	const explicit_dir = await make_tmp_dir()
	const config_file = join(await make_tmp_dir(), 'skill-shed.env')
	await writeFile(config_file, 'DEFAULT_TARGET_DIRECTORY=/should/not/be/used\n')
	const env = {...process.env, SKILL_SHED_CONFIG: config_file}

	const result = await run_init(skill_dir, explicit_dir, [], {env})

	assert.strictEqual(result.code, 0)
	const env_content = await readFile(join(skill_dir, '.env'), 'utf8')
	assert.strictEqual(strip_env_comments(env_content), `TARGET_DIRECTORY=${explicit_dir}`)
})

test('init: .env message says "ignored by Git" when already ignored', async () => {
	const skill_dir = await make_tmp_dir()
	const deploy_dir = await make_tmp_dir()
	await setup_git(skill_dir)

	const result = await run_init(skill_dir, deploy_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), [
		`Initialized ${skill_dir}`,
		`TARGET_DIRECTORY=${deploy_dir}`,
		`.env created in ${skill_dir}, ignored by Git`,
	].join('\n'))
})

test('init: .gitignore hint when .env is not ignored in git repo', async () => {
	const skill_dir = await make_tmp_dir()
	const deploy_dir = await make_tmp_dir()
	await exec_file('git', ['init'], {cwd: skill_dir})

	const result = await run_init(skill_dir, deploy_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), [
		`Initialized ${skill_dir}`,
		`TARGET_DIRECTORY=${deploy_dir}`,
		`.env created in ${skill_dir}, add it to .gitignore`,
	].join('\n'))
})

// ** Deploy

test('deploy: missing .env', async () => {
	const skill_dir = await make_tmp_dir()

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /no \.env file found/)
})

test('deploy: missing TARGET_DIRECTORY in .env', async () => {
	const skill_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, '.env'), '# no TARGET_DIRECTORY here\n')

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /TARGET_DIRECTORY not set/)
})

test('deploy: missing SKILL.md and SKILL.source.md', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.strictEqual(result.stderr.trim(), 'Error: No entry targets SKILL.md')
})

test('deploy: both SKILL.md and SKILL.source.md aborts', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# skill\n')
	await writeFile(join(skill_dir, 'SKILL.source.md'), '# skill\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.strictEqual(result.stderr.trim(), 'Error: Conflicting files: SKILL.md, SKILL.source.md')
})

test('deploy: SKILL.source.md is stripped and deployed as SKILL.md', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(
		join(skill_dir, 'SKILL.source.md'),
		'# My skill\n\n<!-- a comment -->\n\nSome text.\n',
	)
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const deployed = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed, '# My skill\n\nSome text.\n')
})

test('deploy: target directory is created if missing', async () => {
	const skill_dir = await make_tmp_dir()
	const content = '# Test skill\n'
	await writeFile(join(skill_dir, 'SKILL.md'), content)
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${skill_dir}/nonexistent\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const deployed = await readFile(join(skill_dir, 'nonexistent', 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed, content)
})

test('deploy: relative TARGET_DIRECTORY is resolved relative to skill_dir, not cwd', async () => {
	const skill_dir = await make_tmp_dir()
	const other_dir = await make_tmp_dir()
	const content = '# My skill\n'
	await writeFile(join(skill_dir, 'SKILL.md'), content)
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=output\n`)

	const result = await run_deploy(skill_dir, {cwd: other_dir})

	assert.strictEqual(result.code, 0)
	const deployed = await readFile(join(skill_dir, 'output', 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed, content)
})

test('deploy: successful deploy', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	const content = '# My skill\n'
	await writeFile(join(skill_dir, 'SKILL.md'), content)
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const deployed = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed, content)
})

test('deploy: skill file in subdirectory is deployed with directory created', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# Skill\n')
	await mkdir(join(skill_dir, 'examples'))
	await writeFile(join(skill_dir, 'examples', 'demo.md'), 'demo\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const deployed = await readFile(join(target_dir, 'examples', 'demo.md'), 'utf8')
	assert.strictEqual(deployed, 'demo\n')
})

test('deploy: multi-file skill deploys all git-tracked files', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), '# My skill\n<!-- comment -->\nContent.\n')
	await writeFile(join(skill_dir, 'reference.md'), '# Reference\nSome reference.\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const deployed_skill = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed_skill, '# My skill\nContent.\n')
	const deployed_reference = await readFile(join(target_dir, 'reference.md'), 'utf8')
	assert.strictEqual(deployed_reference, '# Reference\nSome reference.\n')
	const target_files = await readdir(target_dir)
	assert.deepStrictEqual(target_files.sort(), [SIDECAR_FILENAME, 'SKILL.md', 'reference.md'])
})

test('deploy: only .source.md files have comments stripped', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), 'A\n<!-- strip me -->\nB\n')
	await writeFile(join(skill_dir, 'extra.md'), 'C\n<!-- keep me -->\nD\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const deployed_skill = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed_skill, 'A\nB\n')
	const deployed_extra = await readFile(join(target_dir, 'extra.md'), 'utf8')
	assert.strictEqual(deployed_extra, 'C\n<!-- keep me -->\nD\n')
})

test('deploy: non-SKILL .source.md file has comments stripped alongside SKILL.source.md', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), '# Skill\n<!-- strip -->\nContent.\n')
	await writeFile(join(skill_dir, 'reference.source.md'), '# Ref\n<!-- strip -->\nRef content.\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const deployed_skill = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed_skill, '# Skill\nContent.\n')
	const deployed_reference = await readFile(join(target_dir, 'reference.md'), 'utf8')
	assert.strictEqual(deployed_reference, '# Ref\nRef content.\n')
	assert.deepStrictEqual((await readdir(target_dir)).sort(), [SIDECAR_FILENAME, 'SKILL.md', 'reference.md'])
})

test('deploy: non-SKILL .source.md has comments stripped when SKILL.md is a pass-through', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# Skill\n<!-- keep -->\nContent.\n')
	await writeFile(join(skill_dir, 'reference.source.md'), '# Ref\n<!-- strip -->\nRef content.\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const deployed_skill = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed_skill, '# Skill\n<!-- keep -->\nContent.\n')
	const deployed_reference = await readFile(join(target_dir, 'reference.md'), 'utf8')
	assert.strictEqual(deployed_reference, '# Ref\nRef content.\n')
	assert.deepStrictEqual((await readdir(target_dir)).sort(), [SIDECAR_FILENAME, 'SKILL.md', 'reference.md'])
})

// *** Deploy: sidecar

test('deploy: sidecar written after first deploy', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	const content = '# My skill\n'
	await writeFile(join(skill_dir, 'SKILL.md'), content)
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const sidecar_raw = await readFile(join(target_dir, SIDECAR_FILENAME), 'utf8')
	const sidecar = JSON.parse(sidecar_raw)
	assert.strictEqual(sidecar.version, 1)
	assert.strictEqual(sidecar.files['SKILL.md'], hash_content(content))
})

test('deploy: second deploy with unchanged target succeeds', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	const content = '# My skill\n'
	await writeFile(join(skill_dir, 'SKILL.md'), content)
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	await run_deploy(skill_dir)
	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
})

test('deploy: aborts when target was directly edited after last deploy', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# My skill\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	await run_deploy(skill_dir)
	await writeFile(join(target_dir, 'SKILL.md'), '# edited directly\n')
	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /SKILL\.md.*modified after last deploy/)
})

test('deploy: --force overwrites directly edited target', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	const content = '# My skill\n'
	await writeFile(join(skill_dir, 'SKILL.md'), content)
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	await run_deploy(skill_dir)
	await writeFile(join(target_dir, 'SKILL.md'), '# edited directly\n')
	const result = await run_deploy(skill_dir, {flags: ['--force']})

	assert.strictEqual(result.code, 0)
	const deployed = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed, content)
})

test('deploy: aborts when target file has no sidecar entry', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# My skill\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)
	await writeFile(join(target_dir, 'SKILL.md'), '# pre-existing\n')

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /SKILL\.md.*not deployed by skill-shed/)
})

test('deploy: --force overwrites file with no sidecar entry', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	const content = '# My skill\n'
	await writeFile(join(skill_dir, 'SKILL.md'), content)
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)
	await writeFile(join(target_dir, 'SKILL.md'), '# pre-existing\n')

	const result = await run_deploy(skill_dir, {flags: ['--force']})

	assert.strictEqual(result.code, 0)
	const deployed = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed, content)
})

// *** Deploy: sentinel
const SENTINEL_FILENAME = '.skill-shed-deploy-in-progress'

test('deploy: aborts when interrupted deploy sentinel present', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# My skill\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)
	await writeFile(join(target_dir, SENTINEL_FILENAME), '')

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /interrupted deploy/)
})

test('deploy: --force proceeds despite sentinel', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	const content = '# My skill\n'
	await writeFile(join(skill_dir, 'SKILL.md'), content)
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)
	await writeFile(join(target_dir, SENTINEL_FILENAME), '')

	const result = await run_deploy(skill_dir, {flags: ['--force']})

	assert.strictEqual(result.code, 0)
	const does_sentinel_exist = await stat(join(target_dir, SENTINEL_FILENAME))
		.then(() => true)
		.catch(() => false)
	assert.ok(!does_sentinel_exist, 'sentinel should be deleted after successful deploy')
})

test('deploy: sentinel absent after successful deploy', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# My skill\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const does_sentinel_exist = await stat(join(target_dir, SENTINEL_FILENAME))
		.then(() => true)
		.catch(() => false)
	assert.ok(!does_sentinel_exist, 'sentinel should not exist after successful deploy')
})

// *** Deploy: stale files

test('deploy: deletes unmodified owned stale file', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# My skill\n')
	await writeFile(join(skill_dir, 'reference.md'), '# Ref\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)
	await run_deploy(skill_dir)

	await unlink(join(skill_dir, 'reference.md'))
	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const does_stale_exist = await stat(join(target_dir, 'reference.md'))
		.then(() => true)
		.catch(() => false)
	assert.ok(!does_stale_exist, 'stale file should be deleted from target')
	const sidecar = JSON.parse(await readFile(join(target_dir, SIDECAR_FILENAME), 'utf8'))
	assert.strictEqual(sidecar.files['reference.md'], undefined)
})

test('deploy: aborts when owned stale file was modified', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# My skill\n')
	await writeFile(join(skill_dir, 'reference.md'), '# Ref\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)
	await run_deploy(skill_dir)

	await unlink(join(skill_dir, 'reference.md'))
	await writeFile(join(target_dir, 'reference.md'), '# Ref edited\n')
	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /stale file.*modified/)
})

test('deploy: --force deletes modified owned stale file', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# My skill\n')
	await writeFile(join(skill_dir, 'reference.md'), '# Ref\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)
	await run_deploy(skill_dir)

	await unlink(join(skill_dir, 'reference.md'))
	await writeFile(join(target_dir, 'reference.md'), '# Ref edited\n')
	const result = await run_deploy(skill_dir, {flags: ['--force']})

	assert.strictEqual(result.code, 0)
	const does_stale_exist = await stat(join(target_dir, 'reference.md'))
		.then(() => true)
		.catch(() => false)
	assert.ok(!does_stale_exist, 'modified stale file should be deleted with --force')
	const sidecar = JSON.parse(await readFile(join(target_dir, SIDECAR_FILENAME), 'utf8'))
	assert.strictEqual(sidecar.files['reference.md'], undefined)
})

// *** find_stale_names

test('find_stale_names: returns empty when sidecar is empty', () => {
	const manifest = [{source_name: 'SKILL.md', target_name: 'SKILL.md', source_content: '', target_content: ''}]
	const sidecar = {version: 1, files: {}}
	assert.deepStrictEqual(find_stale_names(manifest, sidecar), [])
})

test('find_stale_names: returns empty when all sidecar entries are in manifest', () => {
	const manifest = [{source_name: 'SKILL.md', target_name: 'SKILL.md', source_content: '', target_content: ''}]
	const sidecar = {version: 1, files: {'SKILL.md': 'abc123'}}
	assert.deepStrictEqual(find_stale_names(manifest, sidecar), [])
})

test('find_stale_names: returns names in sidecar but not in manifest', () => {
	const manifest = [{source_name: 'SKILL.md', target_name: 'SKILL.md', source_content: '', target_content: ''}]
	const sidecar = {version: 1, files: {'SKILL.md': 'abc123', 'reference.md': 'def456'}}
	assert.deepStrictEqual(find_stale_names(manifest, sidecar), ['reference.md'])
})

// ** strip_html_comments

test('strip_html_comments: empty input unchanged', () => {
	assert.strictEqual(strip_html_comments(''), '')
})

test('strip_html_comments: no comments → unchanged', () => {
	const input = [
		'# Heading',
		'',
		'Some text.',
		'',
	].join('\n')
	assert.strictEqual(strip_html_comments(input), input)
})

test('strip_html_comments: inline comment removed', () => {
	assert.strictEqual(
		strip_html_comments([
			'before <!-- note --> after',
			'',
		].join('\n')),
		[
			'before  after',
			'',
		].join('\n'),
	)
})

test('strip_html_comments: full-line comment dropped', () => {
	assert.strictEqual(
		strip_html_comments([
			'line one',
			'<!-- comment -->',
			'line two',
			'',
		].join('\n')),
		[
			'line one',
			'line two',
			'',
		].join('\n'),
	)
})

test('strip_html_comments: comment between blank lines collapses to one blank line', () => {
	assert.strictEqual(
		strip_html_comments([
			'line one',
			'',
			'<!-- comment -->',
			'',
			'line two',
			'',
		].join('\n')),
		[
			'line one',
			'',
			'line two',
			'',
		].join('\n'),
	)
})

test('strip_html_comments: multiple blank lines before comment are preserved', () => {
	assert.strictEqual(
		strip_html_comments([
			'line one',
			'',
			'',
			'<!-- comment -->',
			'',
			'line two',
			'',
		].join('\n')),
		[
			'line one',
			'',
			'',
			'line two',
			'',
		].join('\n'),
	)
})

test('strip_html_comments: multiline comment dropped', () => {
	assert.strictEqual(
		strip_html_comments([
			'before',
			'<!-- start',
			'middle',
			'end -->',
			'after',
			'',
		].join('\n')),
		[
			'before',
			'after',
			'',
		].join('\n'),
	)
})

test('strip_html_comments: comment inside fenced code block preserved', () => {
	const input = [
		'```',
		'<!-- not stripped -->',
		'```',
		'',
	].join('\n')
	assert.strictEqual(strip_html_comments(input), input)
})

test('strip_html_comments: comment inside tilde-fenced block preserved', () => {
	const input = [
		'~~~',
		'<!-- not stripped -->',
		'~~~',
		'',
	].join('\n')
	assert.strictEqual(strip_html_comments(input), input)
})

test('strip_html_comments: multiline comment inside fenced block preserved', () => {
	const input = [
		'```',
		'<!-- not',
		'stripped -->',
		'```',
		'',
	].join('\n')
	assert.strictEqual(strip_html_comments(input), input)
})

test('strip_html_comments: multiple comments on one line', () => {
	assert.strictEqual(
		strip_html_comments([
			'a <!-- x --> b <!-- y --> c',
			'',
		].join('\n')),
		[
			'a  b  c',
			'',
		].join('\n'),
	)
})

test('strip_html_comments: comment starts mid-line, spans multiple lines, text follows closing', () => {
	assert.strictEqual(
		strip_html_comments([
			'a <!-- x',
			'y',
			'z --> b',
			'c',
			'',
		].join('\n')),
		[
			'a ',
			' b',
			'c',
			'',
		].join('\n'),
	)
})

// ** target_filename

test('target_filename: .md unchanged', () => {
	assert.strictEqual(target_filename('SKILL.md'), 'SKILL.md')
})

test('target_filename: .source.md → .md', () => {
	assert.strictEqual(target_filename('SKILL.source.md'), 'SKILL.md')
})

test('target_filename: non-md extension unchanged', () => {
	assert.strictEqual(target_filename('template.html'), 'template.html')
})

test('target_filename: no extension unchanged', () => {
	assert.strictEqual(target_filename('LICENSE'), 'LICENSE')
})

// ** build_manifest_from_dir

test('build_manifest_from_dir: returns entries with source and target names and contents', async () => {
	const dir = await make_tmp_dir()
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await writeFile(join(dir, 'extra.txt'), 'world')

	const manifest = await build_manifest_from_dir(dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md', 'extra.txt'])
	assert.strictEqual(manifest[0].target_content, 'hello')
	assert.deepStrictEqual(manifest[1].target_content, Buffer.from('world'))
})

test('build_manifest_from_dir: excludes dotfiles', async () => {
	const dir = await make_tmp_dir()
	await writeFile(join(dir, 'SKILL.md'), 'content')
	await writeFile(join(dir, '.env'), 'SECRET=1')
	await writeFile(join(dir, '.gitignore'), '*.log')

	const manifest = await build_manifest_from_dir(dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md'])
})

test('build_manifest_from_dir: empty directory returns empty array', async () => {
	const dir = await make_tmp_dir()

	const manifest = await build_manifest_from_dir(dir)

	assert.strictEqual(manifest.length, 0)
})

test('build_manifest_from_dir: only dotfiles returns empty array', async () => {
	const dir = await make_tmp_dir()
	await writeFile(join(dir, '.env'), 'X=1')

	const manifest = await build_manifest_from_dir(dir)

	assert.strictEqual(manifest.length, 0)
})

test('build_manifest_from_dir: entries are sorted by source_name', async () => {
	const dir = await make_tmp_dir()
	await writeFile(join(dir, 'zebra.txt'), '')
	await writeFile(join(dir, 'alpha.txt'), '')
	await writeFile(join(dir, 'middle.txt'), '')

	const manifest = await build_manifest_from_dir(dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['alpha.txt', 'middle.txt', 'zebra.txt'])
})

test('build_manifest_from_dir: .md source_content is string', async () => {
	const dir = await make_tmp_dir()
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await writeFile(join(dir, 'SKILL.source.md'), 'world')

	const manifest = await build_manifest_from_dir(dir)

	assert.ok(manifest.every(e => typeof e.source_content === 'string'))
})

test('build_manifest_from_dir: non-.md source_content is Buffer', async () => {
	const dir = await make_tmp_dir()
	await writeFile(join(dir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
	await writeFile(join(dir, 'notes.txt'), 'text')

	const manifest = await build_manifest_from_dir(dir)

	assert.ok(manifest.every(e => e.source_content instanceof Buffer))
})

test('build_manifest_from_dir: .source.md strips comments into target_content', async () => {
	const dir = await make_tmp_dir()
	await writeFile(join(dir, 'SKILL.source.md'), '# Hello\n<!-- comment -->\nworld')

	const manifest = await build_manifest_from_dir(dir)

	assert.strictEqual(manifest[0].target_name, 'SKILL.md')
	assert.strictEqual(manifest[0].target_content, '# Hello\nworld')
	assert.strictEqual(manifest[0].source_content, '# Hello\n<!-- comment -->\nworld')
})

test('build_manifest_from_dir: pass-through .md has equal source and target content', async () => {
	const dir = await make_tmp_dir()
	await writeFile(join(dir, 'SKILL.md'), '# Hello')

	const manifest = await build_manifest_from_dir(dir)

	assert.strictEqual(manifest[0].source_name, 'SKILL.md')
	assert.strictEqual(manifest[0].target_name, 'SKILL.md')
	assert.strictEqual(manifest[0].source_content, manifest[0].target_content)
})

// ** build_manifest_from_git_clean

test('build_manifest_from_git_clean: empty repo returns empty array', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await git_commit(dir)

	const manifest = await build_manifest_from_git_clean(dir)

	assert.strictEqual(manifest.length, 0)
})

test('build_manifest_from_git_clean: returns entries for tracked files', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await writeFile(join(dir, 'extra.txt'), 'world')
	await git_commit(dir)

	const manifest = await build_manifest_from_git_clean(dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md', 'extra.txt'])
	assert.strictEqual(manifest[0].target_content, 'hello')
	assert.deepStrictEqual(manifest[1].target_content, Buffer.from('world'))
})

test('build_manifest_from_git_clean: throws when untracked files are present', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'content')
	await git_commit(dir)
	await writeFile(join(dir, 'untracked.txt'), 'ghost')

	await assert.rejects(
		() => build_manifest_from_git_clean(dir),
		/uncommitted changes/,
	)
})

test('build_manifest_from_git_clean: throws when working tree is dirty', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'original')
	await git_commit(dir)
	await writeFile(join(dir, 'SKILL.md'), 'modified')

	await assert.rejects(
		() => build_manifest_from_git_clean(dir),
		/uncommitted changes/,
	)
})

test('build_manifest_from_git_clean: throws when changes are staged', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'original')
	await git_commit(dir)
	await writeFile(join(dir, 'SKILL.md'), 'modified')
	await exec_file('git', ['add', '-A'], {cwd: dir})

	await assert.rejects(
		() => build_manifest_from_git_clean(dir),
		/uncommitted changes/,
	)
})

test('build_manifest_from_git_clean: throws when a tracked file is deleted from disk', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'content')
	await git_commit(dir)
	await unlink(join(dir, 'SKILL.md'))

	await assert.rejects(
		() => build_manifest_from_git_clean(dir),
		/uncommitted changes/,
	)
})

test('build_manifest_from_git_clean: throws when a tracked file is staged for deletion', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'content')
	await git_commit(dir)
	await exec_file('git', ['rm', 'SKILL.md'], {cwd: dir})

	await assert.rejects(
		() => build_manifest_from_git_clean(dir),
		/uncommitted changes/,
	)
})

test('build_manifest_from_git_clean: succeeds when dirty state is outside skill_dir in a larger repo', async () => {
	const parent = await make_tmp_dir()
	await setup_git(parent)
	await writeFile(join(parent, 'other.md'), 'other')
	const skill_dir = join(parent, 'my-skill')
	await mkdir(skill_dir)
	await writeFile(join(skill_dir, 'SKILL.md'), 'content')
	await exec_file('git', ['add', '-A'], {cwd: parent})
	await exec_file('git', ['commit', '-m', 'test'], {cwd: parent})
	await writeFile(join(parent, 'other.md'), 'modified')

	const manifest = await build_manifest_from_git_clean(skill_dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md'])
})

test('build_manifest_from_git_clean: excludes .env via .git/info/exclude', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'content')
	await git_commit(dir)
	await writeFile(join(dir, '.env'), 'TARGET_DIRECTORY=/tmp/x')

	const manifest = await build_manifest_from_git_clean(dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md'])
})

test('build_manifest_from_git_clean: tracked dotfiles are included', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'content')
	await writeFile(join(dir, '.toolrc'), 'setting=1')
	await git_commit(dir)

	const manifest = await build_manifest_from_git_clean(dir)

	assert.ok(manifest.some(e => e.source_name === '.toolrc'))
})

test('build_manifest_from_git_clean: entries are sorted by source_name', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'zebra.txt'), '')
	await writeFile(join(dir, 'SKILL.md'), '')
	await writeFile(join(dir, 'alpha.txt'), '')
	await git_commit(dir)

	const manifest = await build_manifest_from_git_clean(dir)

	assert.deepStrictEqual(
		manifest.map(e => e.source_name),
		['SKILL.md', 'alpha.txt', 'zebra.txt'],
	)
})

test('build_manifest_from_git_clean: .source.md strips comments into target_content', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.source.md'), '# Hello\n<!-- comment -->\nworld')
	await git_commit(dir)

	const manifest = await build_manifest_from_git_clean(dir)

	assert.strictEqual(manifest[0].target_name, 'SKILL.md')
	assert.strictEqual(manifest[0].target_content, '# Hello\nworld')
	assert.strictEqual(manifest[0].source_content, '# Hello\n<!-- comment -->\nworld')
})

test('build_manifest_from_git_clean: pass-through .md has equal source and target content', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), '# Hello')
	await git_commit(dir)

	const manifest = await build_manifest_from_git_clean(dir)

	assert.strictEqual(manifest[0].source_content, manifest[0].target_content)
})

test('build_manifest_from_git_clean: handles files in subdirectories', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'content')
	await mkdir(join(dir, 'examples'))
	await writeFile(join(dir, 'examples', 'demo.source.md'), 'demo\n<!-- comment -->\n')
	await git_commit(dir)

	const manifest = await build_manifest_from_git_clean(dir)

	assert.deepStrictEqual(
		manifest.map(e => e.source_name),
		['SKILL.md', 'examples/demo.source.md'],
	)
	assert.strictEqual(manifest[1].target_name, 'examples/demo.md')
	assert.strictEqual(manifest[1].target_content, 'demo\n')
})

// ** build_manifest_from_git_workdir

// *** Basic

test('build_manifest_from_git_workdir: empty repo returns empty array', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await git_commit(dir)

	const manifest = await build_manifest_from_git_workdir(dir)

	assert.strictEqual(manifest.length, 0)
})

test('build_manifest_from_git_workdir: commit-less repo returns empty array', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)

	const manifest = await build_manifest_from_git_workdir(dir)

	assert.strictEqual(manifest.length, 0)
})

test('build_manifest_from_git_workdir: returns entries for tracked committed files', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await writeFile(join(dir, 'extra.txt'), 'world')
	await git_commit(dir)

	const manifest = await build_manifest_from_git_workdir(dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md', 'extra.txt'])
	assert.strictEqual(manifest[0].target_content, 'hello')
	assert.deepStrictEqual(manifest[1].target_content, Buffer.from('world'))
})

test('build_manifest_from_git_workdir: scoped to skill_dir in a larger repo', async () => {
	const parent = await make_tmp_dir()
	await setup_git(parent)
	await writeFile(join(parent, 'other.md'), 'other')
	const skill_dir = join(parent, 'my-skill')
	await mkdir(skill_dir)
	await writeFile(join(skill_dir, 'SKILL.md'), 'content')
	await exec_file('git', ['add', '-A'], {cwd: parent})
	await exec_file('git', ['commit', '-m', 'test'], {cwd: parent})

	const manifest = await build_manifest_from_git_workdir(skill_dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md'])
})

// *** Content

test('build_manifest_from_git_workdir: reads modified content from disk', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'original')
	await git_commit(dir)
	await writeFile(join(dir, 'SKILL.md'), 'modified')

	const manifest = await build_manifest_from_git_workdir(dir)

	assert.strictEqual(manifest[0].target_content, 'modified')
})

test('build_manifest_from_git_workdir: reads staged modification from disk', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'original')
	await git_commit(dir)
	await writeFile(join(dir, 'SKILL.md'), 'modified')
	await exec_file('git', ['add', 'SKILL.md'], {cwd: dir})

	const manifest = await build_manifest_from_git_workdir(dir)

	assert.strictEqual(manifest[0].target_content, 'modified')
})

test('build_manifest_from_git_workdir: staged then re-modified file reads final disk content', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'original')
	await git_commit(dir)
	await writeFile(join(dir, 'SKILL.md'), 'staged')
	await exec_file('git', ['add', 'SKILL.md'], {cwd: dir})
	await writeFile(join(dir, 'SKILL.md'), 'final')

	const manifest = await build_manifest_from_git_workdir(dir)

	assert.strictEqual(manifest[0].target_content, 'final')
})

test('build_manifest_from_git_workdir: handles modified file in subdirectory', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await mkdir(join(dir, 'examples'))
	await writeFile(join(dir, 'examples', 'demo.source.md'), 'original\n<!-- comment -->\n')
	await git_commit(dir)
	await writeFile(join(dir, 'examples', 'demo.source.md'), 'modified\n<!-- comment -->\n')

	const manifest = await build_manifest_from_git_workdir(dir)

	assert.deepStrictEqual(
		manifest.map(e => e.source_name),
		['SKILL.md', 'examples/demo.source.md'],
	)
	assert.strictEqual(manifest[1].target_name, 'examples/demo.md')
	assert.strictEqual(manifest[1].source_content, 'modified\n<!-- comment -->\n')
	assert.strictEqual(manifest[1].target_content, 'modified\n')
})

test('build_manifest_from_git_workdir: strips HTML comments from .source.md files', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.source.md'), 'hello\n<!-- comment -->\nworld\n')
	await git_commit(dir)

	const manifest = await build_manifest_from_git_workdir(dir)

	assert.strictEqual(manifest[0].target_name, 'SKILL.md')
	assert.strictEqual(manifest[0].source_content, 'hello\n<!-- comment -->\nworld\n')
	assert.strictEqual(manifest[0].target_content, 'hello\nworld\n')
})

// *** Additions

test('build_manifest_from_git_workdir: includes untracked non-ignored files', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'committed')
	await git_commit(dir)
	await writeFile(join(dir, 'untracked.txt'), 'new')

	const manifest = await build_manifest_from_git_workdir(dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md', 'untracked.txt'])
	assert.strictEqual(manifest[0].target_content, 'committed')
	assert.deepStrictEqual(manifest[1].target_content, Buffer.from('new'))
})

test('build_manifest_from_git_workdir: includes staged new file', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await git_commit(dir)
	await writeFile(join(dir, 'SKILL.md'), 'staged')
	await exec_file('git', ['add', 'SKILL.md'], {cwd: dir})

	const manifest = await build_manifest_from_git_workdir(dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md'])
	assert.strictEqual(manifest[0].target_content, 'staged')
})

// *** Deletions

test('build_manifest_from_git_workdir: skips deleted tracked file', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await writeFile(join(dir, 'gone.txt'), 'bye')
	await git_commit(dir)
	await unlink(join(dir, 'gone.txt'))

	const manifest = await build_manifest_from_git_workdir(dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md'])
})

test('build_manifest_from_git_workdir: includes file staged for deletion but still on disk', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await writeFile(join(dir, 'kept.source.md'), 'hello\n<!-- comment -->\nworld\n')
	await git_commit(dir)
	await exec_file('git', ['rm', '--cached', 'kept.source.md'], {cwd: dir})

	const manifest = await build_manifest_from_git_workdir(dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md', 'kept.source.md'])
	assert.strictEqual(manifest[1].source_content, 'hello\n<!-- comment -->\nworld\n')
	assert.strictEqual(manifest[1].target_content, 'hello\nworld\n')
})

// *** Renames

test('build_manifest_from_git_workdir: staged rename includes new name, excludes old name', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await writeFile(join(dir, 'old.txt'), 'content')
	await git_commit(dir)
	await exec_file('git', ['mv', 'old.txt', 'new.txt'], {cwd: dir})

	const manifest = await build_manifest_from_git_workdir(dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md', 'new.txt'])
	assert.deepStrictEqual(manifest[1].target_content, Buffer.from('content'))
})

test('build_manifest_from_git_workdir: unstaged rename includes new name, excludes old name', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await writeFile(join(dir, 'old.txt'), 'content')
	await git_commit(dir)
	await rename(join(dir, 'old.txt'), join(dir, 'new.txt'))

	const manifest = await build_manifest_from_git_workdir(dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md', 'new.txt'])
	assert.deepStrictEqual(manifest[1].target_content, Buffer.from('content'))
})

// *** Exclusions

test('build_manifest_from_git_workdir: excludes ignored files', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await git_commit(dir)
	await writeFile(join(dir, '.env'), 'SECRET=1')

	const manifest = await build_manifest_from_git_workdir(dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md'])
})

test('build_manifest_from_git_workdir: ignores untracked directory', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await git_commit(dir)
	await mkdir(join(dir, 'subdir'))
	await writeFile(join(dir, 'subdir', 'file.txt'), 'content')

	const manifest = await build_manifest_from_git_workdir(dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md'])
	assert.strictEqual(manifest[0].target_content, 'hello')
})

// ** find_target_conflicts

test('find_target_conflicts: returns empty array when no conflicts', () => {
	assert.deepStrictEqual(find_target_conflicts(['SKILL.md', 'extra.txt']), [])
})

test('find_target_conflicts: returns conflicting group', () => {
	const result = find_target_conflicts(['SKILL.md', 'SKILL.source.md'])

	assert.strictEqual(result.length, 1)
	assert.deepStrictEqual(result[0], ['SKILL.md', 'SKILL.source.md'])
})

test('find_target_conflicts: returns multiple conflicting groups', () => {
	const result = find_target_conflicts(['SKILL.source.md', 'SKILL.md', 'extra.source.md', 'extra.md'])

	assert.strictEqual(result.length, 2)
})

test('find_target_conflicts: returns empty array for empty input', () => {
	assert.deepStrictEqual(find_target_conflicts([]), [])
})

// ** validate_manifest

test('validate_manifest: passes when all target_names are unique', () => {
	const manifest = [
		{source_name: 'SKILL.md', target_name: 'SKILL.md', source_content: '', target_content: ''},
		{source_name: 'extra.txt', target_name: 'extra.txt', source_content: Buffer.alloc(0), target_content: Buffer.alloc(0)},
	]

	assert.doesNotThrow(() => validate_manifest(manifest))
})

test('validate_manifest: throws listing all conflicting source names', () => {
	const manifest = [
		{source_name: 'SKILL.source.md', target_name: 'SKILL.md', source_content: '', target_content: ''},
		{source_name: 'SKILL.md', target_name: 'SKILL.md', source_content: '', target_content: ''},
	]

	assert.throws(() => validate_manifest(manifest), new Error('Conflicting files: SKILL.source.md, SKILL.md'))
})

test('validate_manifest: throws when no SKILL.md target present', () => {
	const manifest = [
		{source_name: 'extra.md', target_name: 'extra.md', source_content: '', target_content: ''},
	]

	assert.throws(() => validate_manifest(manifest), new Error('No entry targets SKILL.md'))
})

test('validate_manifest: throws on empty manifest', () => {
	assert.throws(() => validate_manifest([]), new Error('No entry targets SKILL.md'))
})

// ** load_global_config

test('load_global_config: missing config file returns defaults', async () => {
	const nonexistent = join(await make_tmp_dir(), 'nonexistent.json')
	process.env.SKILL_SHED_CONFIG = nonexistent
	try {
		const config = await load_global_config()
		assert.strictEqual(config.default_target_directory, resolve(homedir(), '.claude', 'skills'))
	} finally {
		delete process.env.SKILL_SHED_CONFIG
	}
})

test('load_global_config: reads DEFAULT_TARGET_DIRECTORY from config file', async () => {
	const config_file = join(await make_tmp_dir(), 'skill-shed.env')
	await writeFile(config_file, 'DEFAULT_TARGET_DIRECTORY=/some/path\n')
	process.env.SKILL_SHED_CONFIG = config_file
	try {
		const config = await load_global_config()
		assert.strictEqual(config.default_target_directory, '/some/path')
	} finally {
		delete process.env.SKILL_SHED_CONFIG
	}
})

test('load_global_config: ignores unknown keys', async () => {
	const config_file = join(await make_tmp_dir(), 'skill-shed.env')
	await writeFile(config_file, 'DEFAULT_TARGET_DIRECTORY=/p\nUNKNOWN_KEY=42\n')
	process.env.SKILL_SHED_CONFIG = config_file
	try {
		const config = await load_global_config()
		assert.strictEqual(config.default_target_directory, '/p')
		assert.ok(!('UNKNOWN_KEY' in config))
	} finally {
		delete process.env.SKILL_SHED_CONFIG
	}
})

// ** Help

test('help: no arguments prints general help', async () => {
	const result = await run_help()
	assert.strictEqual(result.code, 0)
	assert.ok(result.stdout.startsWith('skill-shed - manage and deploy agent skills'))
})

test('help: `help` command prints general help', async () => {
	const result = await run_help('help')
	assert.strictEqual(result.code, 0)
	assert.ok(result.stdout.startsWith('skill-shed - manage and deploy agent skills'))
})

test('help: `--help` flag prints general help', async () => {
	const result = await run_help('--help')
	assert.strictEqual(result.code, 0)
	assert.ok(result.stdout.startsWith('skill-shed - manage and deploy agent skills'))
})

test('help: `help init` prints init help', async () => {
	const result = await run_help('help', 'init')
	assert.strictEqual(result.code, 0)
	assert.ok(result.stdout.startsWith('Usage: skill-shed init'))
})

test('help: `-h init` prints init help', async () => {
	const result = await run_help('-h', 'init')
	assert.strictEqual(result.code, 0)
	assert.ok(result.stdout.startsWith('Usage: skill-shed init'))
})

// ** Global config

test('load_global_config: empty DEFAULT_TARGET_DIRECTORY falls back to default', async () => {
	const config_file = join(await make_tmp_dir(), 'skill-shed.env')
	await writeFile(config_file, 'DEFAULT_TARGET_DIRECTORY=\n')
	process.env.SKILL_SHED_CONFIG = config_file
	try {
		const config = await load_global_config()
		assert.strictEqual(config.default_target_directory, resolve(homedir(), '.claude', 'skills'))
	} finally {
		delete process.env.SKILL_SHED_CONFIG
	}
})
