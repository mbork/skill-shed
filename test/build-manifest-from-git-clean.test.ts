// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {writeFile, mkdir, unlink} from 'node:fs/promises'
import {join} from 'node:path'
import {build_manifest_from_git_clean} from '../src/manifest.ts'
import {make_tmp_dir, setup_git, git_commit, exec_file} from './helpers.ts'

// * build_manifest_from_git_clean

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
