// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {writeFile, mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {build_manifest_from_git_ref} from '../src/manifest.ts'
import {make_tmp_dir, setup_git, git_commit, exec_file} from './helpers.ts'

// * build_manifest_from_git_ref

// ** Basic

test('build_manifest_from_git_ref: HEAD returns committed files', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await git_commit(dir)

	const manifest = await build_manifest_from_git_ref(dir, 'HEAD')

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md'])
	assert.strictEqual(manifest[0].target_content, 'hello')
})

test('build_manifest_from_git_ref: branch name as ref returns branch files', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'on-branch')
	await git_commit(dir)
	await exec_file('git', ['checkout', '-b', 'my-branch'], {cwd: dir})
	await writeFile(join(dir, 'extra.txt'), 'extra')
	await git_commit(dir)
	await exec_file('git', ['checkout', 'master'], {cwd: dir})

	const manifest = await build_manifest_from_git_ref(dir, 'my-branch')

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md', 'extra.txt'])
})

test('build_manifest_from_git_ref: tag name as ref returns tagged files', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'tagged')
	await git_commit(dir)
	await exec_file('git', ['tag', 'v1.0'], {cwd: dir})
	await writeFile(join(dir, 'SKILL.md'), 'after-tag')
	await git_commit(dir)

	const manifest = await build_manifest_from_git_ref(dir, 'v1.0')

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md'])
	assert.strictEqual(manifest[0].target_content, 'tagged')
})

test('build_manifest_from_git_ref: abbreviated commit SHA as ref', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await git_commit(dir)
	const short_sha = (await exec_file('git', ['rev-parse', '--short', 'HEAD'], {cwd: dir})).stdout.trim()

	const manifest = await build_manifest_from_git_ref(dir, short_sha)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md'])
	assert.strictEqual(manifest[0].target_content, 'hello')
})

// ** Error cases

test('build_manifest_from_git_ref: invalid ref throws with clear error', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await git_commit(dir)

	await assert.rejects(
		() => build_manifest_from_git_ref(dir, 'nonexistent-ref-xyz'),
		/Cannot resolve ref/,
	)
})

test('build_manifest_from_git_ref: empty repo (no commits) throws', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)

	await assert.rejects(
		() => build_manifest_from_git_ref(dir, 'HEAD'),
		/Cannot resolve ref/,
	)
})

// ** Scoping

test('build_manifest_from_git_ref: scoped to skill_dir in a larger repo', async () => {
	const parent = await make_tmp_dir()
	await setup_git(parent)
	await writeFile(join(parent, 'other.md'), 'other')
	const skill_dir = join(parent, 'my-skill')
	await mkdir(skill_dir)
	await writeFile(join(skill_dir, 'SKILL.md'), 'skill-content')
	await git_commit(parent)

	const manifest = await build_manifest_from_git_ref(skill_dir, 'HEAD')

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md'])
	assert.strictEqual(manifest[0].target_content, 'skill-content')
})

test('build_manifest_from_git_ref: scoped to skill_dir at two levels deep in a larger repo', async () => {
	const parent = await make_tmp_dir()
	await setup_git(parent)
	await writeFile(join(parent, 'root.md'), 'root')
	const skill_dir = join(parent, 'tools', 'my-skill')
	await mkdir(skill_dir, {recursive: true})
	await writeFile(join(skill_dir, 'SKILL.md'), 'deep-skill')
	await writeFile(join(skill_dir, 'helper.txt'), 'helper')
	await git_commit(parent)

	const manifest = await build_manifest_from_git_ref(skill_dir, 'HEAD')

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md', 'helper.txt'])
	assert.strictEqual(manifest[0].target_content, 'deep-skill')
})

// Combines prefix stripping (nested skill_dir) with further-nested files inside the skill.
// Ensures source_name retains the in-skill subpath while losing the repo-to-skill prefix.
test('build_manifest_from_git_ref: nested skill_dir with files in its own subdirectory', async () => {
	const parent = await make_tmp_dir()
	await setup_git(parent)
	await writeFile(join(parent, 'root.md'), 'root')
	const skill_dir = join(parent, 'my-skill')
	await mkdir(join(skill_dir, 'examples'), {recursive: true})
	await writeFile(join(skill_dir, 'SKILL.md'), 'skill')
	await writeFile(join(skill_dir, 'examples', 'demo.md'), 'demo')
	await git_commit(parent)

	const manifest = await build_manifest_from_git_ref(skill_dir, 'HEAD')

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md', 'examples/demo.md'])
	assert.strictEqual(manifest[1].target_content, 'demo')
})

// When the ref is valid but skill_dir has no files at that ref (e.g. the subdirectory didn't
// exist yet), ls-tree exits 0 and returns empty output.  The function returns [] and lets
// validate_manifest report "No entry targets SKILL.md" with an actionable message.
test('build_manifest_from_git_ref: valid ref but skill_dir has no files at that ref returns empty manifest', async () => {
	const parent = await make_tmp_dir()
	await setup_git(parent)
	await writeFile(join(parent, 'root.md'), 'root')
	await git_commit(parent)
	const early_sha = (await exec_file('git', ['rev-parse', 'HEAD'], {cwd: parent})).stdout.trim()
	const skill_dir = join(parent, 'my-skill')
	await mkdir(skill_dir)
	await writeFile(join(skill_dir, 'SKILL.md'), 'content')
	await git_commit(parent)

	const manifest = await build_manifest_from_git_ref(skill_dir, early_sha)

	assert.deepStrictEqual(manifest, [])
})

// ** Historical state

test('build_manifest_from_git_ref: deploys historical state at given SHA, not current HEAD', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'version 1')
	await git_commit(dir)
	const v1_sha = (await exec_file('git', ['rev-parse', 'HEAD'], {cwd: dir})).stdout.trim()
	await writeFile(join(dir, 'SKILL.md'), 'version 2')
	await git_commit(dir)

	const manifest = await build_manifest_from_git_ref(dir, v1_sha)

	assert.strictEqual(manifest[0].target_content, 'version 1')
})

// ** Content

test('build_manifest_from_git_ref: strips HTML comments from .source.md files', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.source.md'), 'hello\n<!-- comment -->\nworld\n')
	await git_commit(dir)

	const manifest = await build_manifest_from_git_ref(dir, 'HEAD')

	assert.strictEqual(manifest[0].target_name, 'SKILL.md')
	assert.strictEqual(manifest[0].source_content, 'hello\n<!-- comment -->\nworld\n')
	assert.strictEqual(manifest[0].target_content, 'hello\nworld\n')
})

test('build_manifest_from_git_ref: preserves binary file content', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	const binary = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x80, 0x0d, 0x0a])
	await writeFile(join(dir, 'data.bin'), binary)
	await git_commit(dir)

	const manifest = await build_manifest_from_git_ref(dir, 'HEAD')

	assert.deepStrictEqual(manifest[0].target_content, binary)
})

test('build_manifest_from_git_ref: handles files in subdirectories', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await mkdir(join(dir, 'examples'))
	await writeFile(join(dir, 'examples', 'demo.md'), 'demo')
	await git_commit(dir)

	const manifest = await build_manifest_from_git_ref(dir, 'HEAD')

	assert.deepStrictEqual(
		manifest.map(e => e.source_name),
		['SKILL.md', 'examples/demo.md'],
	)
	assert.strictEqual(manifest[1].target_content, 'demo')
})

// ** Ordering

test('build_manifest_from_git_ref: entries sorted by source_name', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await writeFile(join(dir, 'zebra.md'), 'z')
	await writeFile(join(dir, 'alpha.md'), 'a')
	await git_commit(dir)

	const manifest = await build_manifest_from_git_ref(dir, 'HEAD')

	assert.deepStrictEqual(
		manifest.map(e => e.source_name),
		['SKILL.md', 'alpha.md', 'zebra.md'],
	)
})

// ** Special characters in filenames

// git ls-tree -z uses null-byte delimiters; filenames with spaces, Unicode, and newlines
// are preserved verbatim in the null-terminated records.
test('build_manifest_from_git_ref: handles filenames with spaces and special characters', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await writeFile(join(dir, 'my file.md'), 'spaced')
	await writeFile(join(dir, 'résumé.md'), 'unicode')
	await writeFile(join(dir, 'my\nfile.md'), 'newline')
	await git_commit(dir)

	const manifest = await build_manifest_from_git_ref(dir, 'HEAD')

	assert.deepStrictEqual(
		manifest.map(e => e.source_name),
		['SKILL.md', 'my\nfile.md', 'my file.md', 'résumé.md'],
	)
	assert.strictEqual(manifest[1].target_content, 'newline')
	assert.strictEqual(manifest[2].target_content, 'spaced')
	assert.strictEqual(manifest[3].target_content, 'unicode')
})

// ** Workdir and index state ignored

// --ref reads from committed tree objects; uncommitted working-tree or staged changes
// have no effect on the manifest.
test('build_manifest_from_git_ref: ignores unstaged and staged changes, returns committed content', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'committed')
	await writeFile(join(dir, 'extra.txt'), 'committed-extra')
	await git_commit(dir)
	// Unstaged change
	await writeFile(join(dir, 'SKILL.md'), 'unstaged')
	// Staged change
	await writeFile(join(dir, 'extra.txt'), 'staged')
	await exec_file('git', ['add', 'extra.txt'], {cwd: dir})

	const manifest = await build_manifest_from_git_ref(dir, 'HEAD')

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md', 'extra.txt'])
	assert.strictEqual(manifest[0].target_content, 'committed')
	assert.deepStrictEqual(manifest[1].target_content, Buffer.from('committed-extra'))
})

// ** Conflict indifference

// --ref reads from committed tree objects; it ignores the index entirely,
// so conflicts in the index do not affect the result.
test('build_manifest_from_git_ref: succeeds even when index has conflicts', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await writeFile(join(dir, 'file.txt'), 'original')
	await git_commit(dir)
	await exec_file('git', ['checkout', '-b', 'other'], {cwd: dir})
	await writeFile(join(dir, 'file.txt'), 'other branch')
	await git_commit(dir)
	await exec_file('git', ['checkout', 'master'], {cwd: dir})
	await writeFile(join(dir, 'file.txt'), 'main branch')
	await git_commit(dir)
	await assert.rejects(() => exec_file('git', ['merge', 'other'], {cwd: dir}))

	// --ref HEAD reads from the committed tree, not the conflicted index
	const manifest = await build_manifest_from_git_ref(dir, 'HEAD')

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md', 'file.txt'])
	assert.deepStrictEqual(manifest[1].target_content, Buffer.from('main branch'))
})
