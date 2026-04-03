// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {writeFile, readFile, readdir, mkdir, stat, unlink} from 'node:fs/promises'
import {join} from 'node:path'
import {SIDECAR_FILENAME, find_stale_names, hash_content} from '../src/sidecar.ts'
import {run_deploy, make_tmp_dir} from './helpers.ts'

// * Deploy

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
	assert.deepStrictEqual(
		(await readdir(target_dir)).sort(),
		[SIDECAR_FILENAME, 'SKILL.md', 'reference.md'],
	)
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
	assert.deepStrictEqual(
		(await readdir(target_dir)).sort(),
		[SIDECAR_FILENAME, 'SKILL.md', 'reference.md'],
	)
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
