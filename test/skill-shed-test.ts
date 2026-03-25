#!/usr/bin/env -S node --experimental-strip-types

// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp, writeFile, readFile, readdir, utimes} from 'node:fs/promises'
import {tmpdir, homedir} from 'node:os'
import {join, resolve, dirname, basename} from 'node:path'
import {fileURLToPath} from 'node:url'

const exec_file = promisify(execFile)
const script = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'skill-shed.ts')

// * Helpers

interface Run_result {stdout: string, stderr: string, code: number}

async function run_init(skill_dir: string, deploy_dir?: string): Promise<Run_result> {
	const extra_args = deploy_dir ? [deploy_dir] : []
	try {
		const result = await exec_file('node', [script, 'init', skill_dir, ...extra_args])
		return {stdout: result.stdout, stderr: result.stderr, code: 0}
	} catch (e: unknown) {
		const err = e as {stdout?: string, stderr?: string, code?: number}
		return {stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code ?? 1}
	}
}

async function run_deploy(skill_dir: string): Promise<Run_result> {
	const env = {...process.env}
	delete env.TARGET_DIRECTORY
	try {
		const result = await exec_file('node', [script, 'deploy', skill_dir], {env})
		return {stdout: result.stdout, stderr: result.stderr, code: 0}
	} catch (e: unknown) {
		const err = e as {stdout?: string, stderr?: string, code?: number}
		return {stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code ?? 1}
	}
}

async function make_tmp_dir(): Promise<string> {
	return mkdtemp(join(tmpdir(), 'skill-shed-test-'))
}

// * Tests

// ** Init

test('init: creates skill dir and .env when dir does not exist', async () => {
	const parent = await make_tmp_dir()
	const skill_dir = join(parent, 'my-skill')
	const deploy_dir = await make_tmp_dir()

	const result = await run_init(skill_dir, deploy_dir)

	assert.strictEqual(result.code, 0)
	assert.match(result.stdout, /Initialized/)
	assert.match(result.stdout, new RegExp(`TARGET_DIRECTORY=${deploy_dir}`))
	const env_content = await readFile(join(skill_dir, '.env'), 'utf8')
	assert.match(env_content, new RegExp(`TARGET_DIRECTORY=${deploy_dir}`))
	const skill_md_content = await readFile(join(skill_dir, 'SKILL.md'), 'utf8')
	assert.match(skill_md_content, /^---\nname: my-skill$/m)
	assert.match(skill_md_content, /^description: >$/m)
	assert.match(skill_md_content, /^  /m)
	assert.match(skill_md_content, /^allowed-tools: /m)
	assert.match(skill_md_content, /# My-skill skill/)
	const files = await readdir(skill_dir)
	assert.deepStrictEqual(files.sort(), ['.env', 'SKILL.md'])
})

test('init: creates .env in existing dir', async () => {
	const skill_dir = await make_tmp_dir()
	const deploy_dir = await make_tmp_dir()
	const skill_md_content = '# My skill\n'
	await writeFile(join(skill_dir, 'SKILL.md'), skill_md_content)

	const result = await run_init(skill_dir, deploy_dir)

	assert.strictEqual(result.code, 0)
	assert.match(result.stdout, /Initialized/)
	assert.match(result.stdout, new RegExp(`TARGET_DIRECTORY=${deploy_dir}`))
	const env_content = await readFile(join(skill_dir, '.env'), 'utf8')
	assert.match(env_content, new RegExp(`TARGET_DIRECTORY=${deploy_dir}`))
	const skill_md_after = await readFile(join(skill_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(skill_md_after, skill_md_content)
	const files = await readdir(skill_dir)
	assert.deepStrictEqual(files.sort(), ['.env', 'SKILL.md'])
})

test('init: aborts if .env already exists', async () => {
	const skill_dir = await make_tmp_dir()
	const original_env = 'TARGET_DIRECTORY=/some/path\n'
	await writeFile(join(skill_dir, '.env'), original_env)

	const result = await run_init(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.strictEqual(result.stdout, '')
	assert.match(result.stderr, /\.env already exists/)
	const env_after = await readFile(join(skill_dir, '.env'), 'utf8')
	assert.strictEqual(env_after, original_env)
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
	assert.match(result.stdout, /Initialized/)
	assert.match(result.stdout, new RegExp(`TARGET_DIRECTORY=${deploy_dir}`))
	const skill_md_after = await readFile(join(skill_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(skill_md_after, original)
})

test('init: default deploy dir is ~/.claude/skills/<skill-name>', async () => {
	const parent = await make_tmp_dir()
	const skill_dir = join(parent, 'my-skill')

	const result = await run_init(skill_dir)

	assert.strictEqual(result.code, 0)
	const expected_deploy_dir = resolve(homedir(), '.claude', 'skills', basename(skill_dir))
	assert.match(result.stdout, /Initialized/)
	assert.match(result.stdout, new RegExp(`TARGET_DIRECTORY=${expected_deploy_dir}`))
	const env_content = await readFile(join(skill_dir, '.env'), 'utf8')
	assert.match(env_content, new RegExp(`TARGET_DIRECTORY=${expected_deploy_dir}`))
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

test('deploy: missing SKILL.md', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 1)
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

test('deploy: mtime guard aborts when target is newer', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# My skill\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	// First deploy
	const first = await run_deploy(skill_dir)

	assert.strictEqual(first.code, 0)

	// Make target appear newer than source
	const future = new Date(Date.now() + 60_000)
	await utimes(join(target_dir, 'SKILL.md'), future, future)

	// Second deploy
	const second = await run_deploy(skill_dir)

	assert.strictEqual(second.code, 1)
	assert.match(second.stderr, /is newer than source/)
})

test('deploy: mtime guard allows deploy when source is newer', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# My skill\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	// First deploy
	const first = await run_deploy(skill_dir)

	assert.strictEqual(first.code, 0)

	// Make source appear newer than target
	const future = new Date(Date.now() + 60_000)
	await utimes(join(skill_dir, 'SKILL.md'), future, future)

	// Second deploy
	const second = await run_deploy(skill_dir)

	assert.strictEqual(second.code, 0)
})
