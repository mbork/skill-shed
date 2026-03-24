#!/usr/bin/env -S node --experimental-strip-types

// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp, writeFile, readFile, utimes} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'

const exec_file = promisify(execFile)
const script = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'skill-shed.ts')

// * Helpers

interface Run_result {stdout: string, stderr: string, code: number}

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

	const second = await run_deploy(skill_dir)
	assert.strictEqual(second.code, 0)
})
