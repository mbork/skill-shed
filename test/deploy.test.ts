// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {chmod, mkdir, readdir, readFile, rmdir, stat, symlink, unlink, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {homedir} from 'node:os'
import {SIDECAR_FILENAME, hash_content} from '../src/sidecar.ts'
import {run_deploy, run_script, make_tmp_dir, make_skill_dir, skill_md, setup_skill_dir_with_distinct_layers} from './helpers.ts'

// * Deploy

// ** Deploy: basic flows

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

test('deploy: expands ~ in TARGET_DIRECTORY', async () => {
	const skill_dir = await make_skill_dir()
	const target_name = `skill-shed-tilde-test-${Date.now()}`
	const target_dir = resolve(homedir(), target_name)
	await writeFile(join(skill_dir, 'SKILL.md'), skill_md('content'))
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=~/${target_name}\n`)
	try {
		const result = await run_deploy(skill_dir)
		assert.strictEqual(result.code, 0)
		const deployed = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
		assert.strictEqual(deployed, skill_md('content'))
	} finally {
		await unlink(join(target_dir, 'SKILL.md'))
		await unlink(join(target_dir, SIDECAR_FILENAME))
		await rmdir(target_dir)
	}
})

test('deploy: missing SKILL.md and SKILL.source.md', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /error: no file targets SKILL\.md/)
})

test('deploy: both SKILL.md and SKILL.source.md aborts', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# skill\n')
	await writeFile(join(skill_dir, 'SKILL.source.md'), '# skill\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /error: conflicting source files/)
})

test('deploy: aborts on a lint error beyond the structural checks (no frontmatter)', async () => {
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# Skill\n\nNo frontmatter here.\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /error: .*has no frontmatter/)
	// The lint gate runs before any write (even the mkdir/sentinel/sidecar), so the target
	// dir stays empty.  readdir lists hidden entries too, so this catches a stray sentinel
	// or sidecar, not just a missing SKILL.md.
	const target_entries = await readdir(target_dir)
	assert.deepStrictEqual(target_entries, [], 'deploy must abort before writing any file')
})

test('deploy: prints lint warnings as a heads-up but still deploys', async () => {
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	const content = skill_md('# Skill\n\nBody text.\n')
	await writeFile(join(skill_dir, 'SKILL.md'), content)
	// orphan.md is never referenced from SKILL.md, so it triggers a warning (not an error).
	await writeFile(join(skill_dir, 'orphan.md'), '# Orphan\n\nNot referenced.\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.match(result.stderr, /orphan\.md:0: warning: file not referenced from SKILL\.md/)
	const deployed = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed, content)
})

test('deploy: SKILL.source.md is stripped and deployed as SKILL.md', async () => {
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(
		join(skill_dir, 'SKILL.source.md'),
		skill_md('# My skill\n\n<!-- a comment -->\n\nSome text.\n'),
	)
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const deployed = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed, skill_md('# My skill\n\nSome text.\n'))
})

test('deploy: target directory is created if missing', async () => {
	const skill_dir = await make_skill_dir()
	const content = skill_md('# Test skill\n')
	await writeFile(join(skill_dir, 'SKILL.md'), content)
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${skill_dir}/nonexistent\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const deployed = await readFile(join(skill_dir, 'nonexistent', 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed, content)
})

test('deploy: relative TARGET_DIRECTORY is resolved relative to skill_dir, not cwd', async () => {
	const skill_dir = await make_skill_dir()
	const other_dir = await make_tmp_dir()
	const content = skill_md('# My skill\n')
	await writeFile(join(skill_dir, 'SKILL.md'), content)
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=output\n`)

	const result = await run_deploy(skill_dir, {cwd: other_dir})

	assert.strictEqual(result.code, 0)
	const deployed = await readFile(join(skill_dir, 'output', 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed, content)
})

test('deploy: successful deploy', async () => {
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	const content = skill_md('# My skill\n')
	await writeFile(join(skill_dir, 'SKILL.md'), content)
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const deployed = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed, content)
})

test('deploy: skill file in subdirectory is deployed with directory created', async () => {
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), skill_md('# Skill\n'))
	await mkdir(join(skill_dir, 'examples'))
	await writeFile(join(skill_dir, 'examples', 'demo.md'), 'demo\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const deployed = await readFile(join(target_dir, 'examples', 'demo.md'), 'utf8')
	assert.strictEqual(deployed, 'demo\n')
})

test('deploy: multi-file skill deploys all git-tracked files', async () => {
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), skill_md('# My skill\n<!-- comment -->\nContent.\n'))
	await writeFile(join(skill_dir, 'reference.md'), '# Reference\nSome reference.\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const deployed_skill = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed_skill, skill_md('# My skill\nContent.\n'))
	const deployed_reference = await readFile(join(target_dir, 'reference.md'), 'utf8')
	assert.strictEqual(deployed_reference, '# Reference\nSome reference.\n')
	const target_files = await readdir(target_dir)
	assert.deepStrictEqual(target_files.sort(), [SIDECAR_FILENAME, 'SKILL.md', 'reference.md'])
})

test('deploy: only .source.md files have comments stripped', async () => {
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), skill_md('A\n<!-- strip me -->\nB\n'))
	await writeFile(join(skill_dir, 'extra.md'), 'C\n<!-- keep me -->\nD\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const deployed_skill = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed_skill, skill_md('A\nB\n'))
	const deployed_extra = await readFile(join(target_dir, 'extra.md'), 'utf8')
	assert.strictEqual(deployed_extra, 'C\n<!-- keep me -->\nD\n')
})

test('deploy: non-SKILL .source.md file has comments stripped alongside SKILL.source.md', async () => {
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), skill_md('# Skill\n<!-- strip -->\nContent.\n'))
	await writeFile(join(skill_dir, 'reference.source.md'), '# Ref\n<!-- strip -->\nRef content.\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const deployed_skill = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed_skill, skill_md('# Skill\nContent.\n'))
	const deployed_reference = await readFile(join(target_dir, 'reference.md'), 'utf8')
	assert.strictEqual(deployed_reference, '# Ref\nRef content.\n')
	assert.deepStrictEqual(
		(await readdir(target_dir)).sort(),
		[SIDECAR_FILENAME, 'SKILL.md', 'reference.md'],
	)
})

test('deploy: non-SKILL .source.md has comments stripped when SKILL.md is a pass-through', async () => {
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), skill_md('# Skill\n<!-- keep -->\nContent.\n'))
	await writeFile(join(skill_dir, 'reference.source.md'), '# Ref\n<!-- strip -->\nRef content.\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const deployed_skill = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed_skill, skill_md('# Skill\n<!-- keep -->\nContent.\n'))
	const deployed_reference = await readFile(join(target_dir, 'reference.md'), 'utf8')
	assert.strictEqual(deployed_reference, '# Ref\nRef content.\n')
	assert.deepStrictEqual(
		(await readdir(target_dir)).sort(),
		[SIDECAR_FILENAME, 'SKILL.md', 'reference.md'],
	)
})

// ** Deploy: sidecar

test('deploy: sidecar written after first deploy', async () => {
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	const content = skill_md('# My skill\n')
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
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	const content = skill_md('# My skill\n')
	await writeFile(join(skill_dir, 'SKILL.md'), content)
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	await run_deploy(skill_dir)
	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const deployed = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed, content)
})

test('deploy: aborts when target was directly edited after last deploy', async () => {
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), skill_md('# My skill\n'))
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	await run_deploy(skill_dir)
	await writeFile(join(target_dir, 'SKILL.md'), '# edited directly\n')
	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /SKILL\.md.*modified after last deploy/)
})

test('deploy: --force overwrites directly edited target', async () => {
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	const content = skill_md('# My skill\n')
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
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), skill_md('# My skill\n'))
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)
	await writeFile(join(target_dir, 'SKILL.md'), '# pre-existing\n')

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /SKILL\.md.*not deployed by skill-shed/)
})

test('deploy: --force overwrites file with no sidecar entry', async () => {
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	const content = skill_md('# My skill\n')
	await writeFile(join(skill_dir, 'SKILL.md'), content)
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)
	await writeFile(join(target_dir, 'SKILL.md'), '# pre-existing\n')

	const result = await run_deploy(skill_dir, {flags: ['--force']})

	assert.strictEqual(result.code, 0)
	const deployed = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed, content)
})

// ** Deploy: sentinel
const SENTINEL_FILENAME = '.skill-shed-deploy-in-progress'

test('deploy: aborts when interrupted deploy sentinel present', async () => {
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), skill_md('# My skill\n'))
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)
	await writeFile(join(target_dir, SENTINEL_FILENAME), '')

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /interrupted deploy/)
})

test('deploy: --force proceeds despite sentinel', async () => {
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	const content = skill_md('# My skill\n')
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
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), skill_md('# My skill\n'))
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const does_sentinel_exist = await stat(join(target_dir, SENTINEL_FILENAME))
		.then(() => true)
		.catch(() => false)
	assert.ok(!does_sentinel_exist, 'sentinel should not exist after successful deploy')
})

// ** Deploy: stale files

test('deploy: deletes unmodified owned stale file', async () => {
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), skill_md('# My skill\n'))
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
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), skill_md('# My skill\n'))
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
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), skill_md('# My skill\n'))
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

// ** Deploy: source modes and uncommon errors

test('deploy: MANIFEST_COMMAND deploys files listed by the command', async () => {
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), skill_md('# From command\n'))
	// These files exist in skill_dir but MANIFEST_COMMAND does not echo them, so they
	// must NOT be deployed.
	await writeFile(join(skill_dir, 'extra.md'), '# Extra\n')
	await mkdir(join(skill_dir, 'subdir'))
	await writeFile(join(skill_dir, 'subdir', 'nested.md'), '# Nested\n')
	await writeFile(
		join(skill_dir, '.env'),
		`TARGET_DIRECTORY=${target_dir}\nMANIFEST_COMMAND=echo SKILL.md\n`,
	)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const deployed = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed, skill_md('# From command\n'))
	const entries = await readdir(target_dir)
	assert.deepStrictEqual(entries.toSorted(), [SIDECAR_FILENAME, 'SKILL.md'])
})

test('deploy: builder error is reported and exits non-zero', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# Skill\n')
	await writeFile(
		join(skill_dir, '.env'),
		`TARGET_DIRECTORY=${target_dir}\nMANIFEST_COMMAND=false\n`,
	)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /Error:.*MANIFEST_COMMAND failed/)
})

test('deploy: --workdir reads working tree, not index or HEAD', async () => {
	const {skill_dir, target_dir} = await setup_skill_dir_with_distinct_layers()

	const result = await run_script(['deploy', skill_dir, '--workdir'])

	assert.strictEqual(result.code, 0)
	const deployed = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed, skill_md('workdir\n'))
})

test('deploy: --staged reads index, not working tree or HEAD', async () => {
	const {skill_dir, target_dir} = await setup_skill_dir_with_distinct_layers()

	const result = await run_script(['deploy', skill_dir, '--staged'])

	assert.strictEqual(result.code, 0)
	const deployed = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed, skill_md('staged\n'))
})

test('deploy: --ref HEAD^ reads named commit, not HEAD or index or working tree', async () => {
	const {skill_dir, target_dir} = await setup_skill_dir_with_distinct_layers()

	const result = await run_script(['deploy', skill_dir, '--ref', 'HEAD^'])

	assert.strictEqual(result.code, 0)
	const deployed = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed, skill_md('older\n'))
})

test('deploy: non-ENOENT error reading .env is reported', async () => {
	const skill_dir = await make_tmp_dir()
	await mkdir(join(skill_dir, '.env'))

	const result = await run_script(['deploy', skill_dir])

	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /Error reading \.env:/)
})

test('deploy: non-ENOENT error from sentinel stat propagates', async () => {
	// Contrived ELOOP via self-symlink covers has_sentinel's rethrow: when stat fails
	// for any non-ENOENT reason, deploy must surface the error rather than proceed.
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), skill_md('# Skill\n'))
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)
	await run_deploy(skill_dir)

	// Self-referential symlink at the sentinel path: stat() loops and throws ELOOP.
	const sentinel_path = join(target_dir, '.skill-shed-deploy-in-progress')
	await symlink('.skill-shed-deploy-in-progress', sentinel_path)

	const result = await run_deploy(skill_dir)

	assert.notStrictEqual(result.code, 0)
	assert.match(result.stderr, /ELOOP/)
})

test('deploy: non-ENOENT error during stale cleanup propagates', async () => {
	// Tightening perms on a sub-directory of target_dir makes unlink fail with EACCES;
	// covers the stale-cleanup rethrow that prevents silently-skipped cleanup failures.
	const skill_dir = await make_skill_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), skill_md('# Skill\n'))
	await mkdir(join(skill_dir, 'sub'))
	await writeFile(join(skill_dir, 'sub', 'reference.md'), '# Ref\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)
	await run_deploy(skill_dir)

	await unlink(join(skill_dir, 'sub', 'reference.md'))
	await chmod(join(target_dir, 'sub'), 0o500)
	try {
		const result = await run_deploy(skill_dir)
		assert.notStrictEqual(result.code, 0)
		assert.match(result.stderr, /EACCES/)
	} finally {
		await chmod(join(target_dir, 'sub'), 0o755)
	}
})
