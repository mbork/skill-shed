// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {writeFile, mkdir, rename, unlink} from 'node:fs/promises'
import {join} from 'node:path'
import {build_manifest_from_git_workdir} from '../src/manifest.ts'
import {make_tmp_dir, setup_git, git_commit, exec_file} from './helpers.ts'

// * build_manifest_from_git_workdir

// ** Basic

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

test('build_manifest_from_git_workdir: untracked file in skill_dir subdirectory has correct source_name', async () => {
	// Regression: git status --porcelain returns repo-root-relative paths,
	// so files in a subdirectory must be re-relativized to skill_dir.
	const parent = await make_tmp_dir()
	await setup_git(parent)
	const skill_dir = join(parent, 'my-skill')
	await mkdir(skill_dir)
	await writeFile(join(skill_dir, 'SKILL.md'), 'committed')
	await exec_file('git', ['add', '-A'], {cwd: parent})
	await exec_file('git', ['commit', '-m', 'test'], {cwd: parent})
	await writeFile(join(skill_dir, 'extra.txt'), 'untracked')

	const manifest = await build_manifest_from_git_workdir(skill_dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md', 'extra.txt'])
	assert.deepStrictEqual(manifest[1].target_content, Buffer.from('untracked'))
})

// ** Content

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

// ** Additions

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

// ** Deletions

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

// ** Renames

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

// ** Exclusions

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
