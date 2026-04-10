// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {writeFile, mkdir, unlink, rename} from 'node:fs/promises'
import {join} from 'node:path'
import {build_manifest_from_git_staged} from '../src/manifest.ts'
import {make_tmp_dir, setup_git, git_commit, exec_file} from './helpers.ts'

// * build_manifest_from_git_staged

// ** Basic

// "Counterpart:" comments below refer to the analogous test in the `--workdir` test suite.
// They explain how `--staged` behavior differs from (or mirrors) the `--workdir` case.

// Counterpart: "empty repo returns empty array"
// Staged aborts instead of returning empty: nothing staged means no point using --staged.
test('build_manifest_from_git_staged: commit-less repo with nothing staged throws', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)

	await assert.rejects(
		() => build_manifest_from_git_staged(dir),
		/nothing staged/,
	)
})

// Counterpart: "commit-less repo returns empty array"
test('build_manifest_from_git_staged: commit-less repo with staged file returns entry', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await exec_file('git', ['add', 'SKILL.md'], {cwd: dir})

	const manifest = await build_manifest_from_git_staged(dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md'])
	assert.strictEqual(manifest[0].target_content, 'hello')
})

// Counterpart: "returns entries for tracked committed files" (positive case)
// The committed-only case throws (nothing staged); this tests the positive path.
test('build_manifest_from_git_staged: committed files with nothing staged throws', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await git_commit(dir)

	await assert.rejects(
		() => build_manifest_from_git_staged(dir),
		/nothing staged/,
	)
})

test('build_manifest_from_git_staged: returns entries for committed files with a staged addition', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await git_commit(dir)
	await writeFile(join(dir, 'extra.txt'), 'world')
	await exec_file('git', ['add', 'extra.txt'], {cwd: dir})

	const manifest = await build_manifest_from_git_staged(dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md', 'extra.txt'])
	assert.strictEqual(manifest[0].target_content, 'hello')
	assert.deepStrictEqual(manifest[1].target_content, Buffer.from('world'))
})

// Counterpart: "scoped to skill_dir in a larger repo"
test('build_manifest_from_git_staged: scoped to skill_dir in a larger repo', async () => {
	const parent = await make_tmp_dir()
	await setup_git(parent)
	await writeFile(join(parent, 'other.md'), 'other')
	const skill_dir = join(parent, 'my-skill')
	await mkdir(skill_dir)
	await writeFile(join(skill_dir, 'SKILL.md'), 'content')
	await exec_file('git', ['add', '-A'], {cwd: parent})
	await exec_file('git', ['commit', '-m', 'test'], {cwd: parent})
	await writeFile(join(skill_dir, 'extra.txt'), 'extra')
	await exec_file('git', ['add', join(skill_dir, 'extra.txt')], {cwd: parent})

	const manifest = await build_manifest_from_git_staged(skill_dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md', 'extra.txt'])
})

// New: staged changes in parent only (outside skill_dir) must not count as "something staged"
test('build_manifest_from_git_staged: staged changes only outside skill_dir throws', async () => {
	const parent = await make_tmp_dir()
	await setup_git(parent)
	const skill_dir = join(parent, 'my-skill')
	await mkdir(skill_dir)
	await writeFile(join(skill_dir, 'SKILL.md'), 'content')
	await writeFile(join(parent, 'other.md'), 'other')
	await exec_file('git', ['add', '-A'], {cwd: parent})
	await exec_file('git', ['commit', '-m', 'initial'], {cwd: parent})
	await writeFile(join(parent, 'other.md'), 'changed')
	await exec_file('git', ['add', 'other.md'], {cwd: parent})

	await assert.rejects(
		() => build_manifest_from_git_staged(skill_dir),
		/nothing staged/,
	)
})

// No counterpart for "untracked file in skill_dir subdirectory has correct source_name":
// untracked files are not in the index and cannot appear in the staged manifest.

// Counterpart: "skill_dir wholly untracked in a larger repo"
test('build_manifest_from_git_staged: skill_dir files staged but not committed in a larger repo', async () => {
	const parent = await make_tmp_dir()
	await setup_git(parent)
	await writeFile(join(parent, 'root.md'), 'root')
	await exec_file('git', ['add', '-A'], {cwd: parent})
	await exec_file('git', ['commit', '-m', 'initial'], {cwd: parent})
	const skill_dir = join(parent, 'my-skill')
	await mkdir(skill_dir)
	await writeFile(join(skill_dir, 'SKILL.md'), 'hello')
	await writeFile(join(skill_dir, 'extra.txt'), 'world')
	await exec_file('git', ['add', '-A'], {cwd: parent})

	const manifest = await build_manifest_from_git_staged(skill_dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md', 'extra.txt'])
	assert.strictEqual(manifest[0].target_content, 'hello')
	assert.deepStrictEqual(manifest[1].target_content, Buffer.from('world'))
})

// ** Content

// No counterpart for "reads modified content from disk":
// --staged always reads from the index, never from disk.

// Binary files: content must survive the git cat-file blob round-trip without corruption.
test('build_manifest_from_git_staged: preserves binary file content', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	const binary = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x80, 0x0d, 0x0a])
	await writeFile(join(dir, 'data.bin'), binary)
	await exec_file('git', ['add', 'data.bin'], {cwd: dir})

	const manifest = await build_manifest_from_git_staged(dir)

	assert.deepStrictEqual(manifest[0].target_content, binary)
})

// Counterpart: "staged then re-modified file reads final disk content" (inverse!)
// --staged uses the staged version even when the disk has been further modified.
test('build_manifest_from_git_staged: staged-then-re-modified file uses staged version, not final disk content', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'original')
	await git_commit(dir)
	await writeFile(join(dir, 'SKILL.md'), 'staged')
	await exec_file('git', ['add', 'SKILL.md'], {cwd: dir})
	await writeFile(join(dir, 'SKILL.md'), 'final')

	const manifest = await build_manifest_from_git_staged(dir)

	assert.strictEqual(manifest[0].target_content, 'staged')
})

// Counterpart: "handles modified file in subdirectory"
test('build_manifest_from_git_staged: handles staged modification in subdirectory', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await mkdir(join(dir, 'examples'))
	await writeFile(join(dir, 'examples', 'demo.md'), 'original')
	await git_commit(dir)
	await writeFile(join(dir, 'examples', 'demo.md'), 'modified')
	await exec_file('git', ['add', join('examples', 'demo.md')], {cwd: dir})

	const manifest = await build_manifest_from_git_staged(dir)

	assert.deepStrictEqual(
		manifest.map(e => e.source_name),
		['SKILL.md', 'examples/demo.md'],
	)
	assert.strictEqual(manifest[1].target_content, 'modified')
})

// Counterpart: "strips HTML comments from .source.md files"
test('build_manifest_from_git_staged: strips HTML comments from staged .source.md files', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.source.md'), 'hello\n<!-- comment -->\nworld\n')
	await exec_file('git', ['add', 'SKILL.source.md'], {cwd: dir})

	const manifest = await build_manifest_from_git_staged(dir)

	assert.strictEqual(manifest[0].target_name, 'SKILL.md')
	assert.strictEqual(manifest[0].source_content, 'hello\n<!-- comment -->\nworld\n')
	assert.strictEqual(manifest[0].target_content, 'hello\nworld\n')
})

// ** Additions

// No counterpart for "includes untracked non-ignored files":
// untracked files are not in the index.

// Counterpart: "includes staged new file"
test('build_manifest_from_git_staged: includes staged new file', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await git_commit(dir)
	await writeFile(join(dir, 'SKILL.md'), 'staged')
	await exec_file('git', ['add', 'SKILL.md'], {cwd: dir})

	const manifest = await build_manifest_from_git_staged(dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md'])
	assert.strictEqual(manifest[0].target_content, 'staged')
})

// ** Deletions

// Counterpart: "skips deleted tracked file" (inverse!)
// --staged reads from the index; a file deleted from disk but not staged is still in the index.
// A separate staged change is needed so the function doesn't abort with "nothing staged".
test('build_manifest_from_git_staged: includes file deleted from disk but not staged', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await writeFile(join(dir, 'gone.txt'), 'bye')
	await git_commit(dir)
	await unlink(join(dir, 'gone.txt'))
	await writeFile(join(dir, 'SKILL.md'), 'updated')
	await exec_file('git', ['add', 'SKILL.md'], {cwd: dir})

	const manifest = await build_manifest_from_git_staged(dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md', 'gone.txt'])
	assert.strictEqual(manifest[0].target_content, 'updated')
	assert.deepStrictEqual(manifest[1].target_content, Buffer.from('bye'))
})

// Counterpart: "includes file staged for deletion but still on disk" (inverse!)
// --staged reflects the index: a staged deletion removes the file from the manifest.
test('build_manifest_from_git_staged: excludes file staged for deletion', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await writeFile(join(dir, 'gone.txt'), 'bye')
	await git_commit(dir)
	await exec_file('git', ['rm', '--cached', 'gone.txt'], {cwd: dir})

	const manifest = await build_manifest_from_git_staged(dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md'])
})

// ** Renames

// Counterpart: "staged rename includes new name, excludes old name"
test('build_manifest_from_git_staged: staged rename includes new name, excludes old name', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await writeFile(join(dir, 'ante.txt'), 'content')
	await git_commit(dir)
	await exec_file('git', ['mv', 'ante.txt', 'post.txt'], {cwd: dir})

	const manifest = await build_manifest_from_git_staged(dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md', 'post.txt'])
	assert.deepStrictEqual(manifest[1].target_content, Buffer.from('content'))
})

// Counterpart: "unstaged rename includes new name, excludes old name" (inverse!)
// An unstaged rename (mv, not git mv) leaves old name in the index; new file is untracked.
// A separate staged change is needed so the function doesn't abort with "nothing staged".
test('build_manifest_from_git_staged: unstaged rename: manifest includes old name, not new name', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await writeFile(join(dir, 'ante.txt'), 'content')
	await git_commit(dir)
	await rename(join(dir, 'ante.txt'), join(dir, 'post.txt'))
	await writeFile(join(dir, 'SKILL.md'), 'updated')
	await exec_file('git', ['add', 'SKILL.md'], {cwd: dir})

	const manifest = await build_manifest_from_git_staged(dir)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md', 'ante.txt'])
})

// ** Conflicts

// Stage 1/2/3 entries in the index indicate unresolved conflicts (from merge, rebase, cherry-pick,
// etc.).  Deploying would produce garbled or wrong content, so --staged aborts.
test('build_manifest_from_git_staged: throws when index has conflicts', async () => {
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
	// git exits non-zero when the merge produces conflicts
	await assert.rejects(
		() => exec_file('git', ['merge', 'other'], {cwd: dir}),
	)

	await assert.rejects(
		() => build_manifest_from_git_staged(dir),
		/conflicts/,
	)
})

// ** Special characters in filenames

// The -z flag in git ls-files uses null-byte delimiters, which handles spaces and other
// special characters in filenames correctly.
test('build_manifest_from_git_staged: handles filenames with spaces and special characters', async () => {
	const dir = await make_tmp_dir()
	await setup_git(dir)
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await writeFile(join(dir, 'my file.md'), 'spaced')
	await writeFile(join(dir, 'résumé.md'), 'unicode')
	await writeFile(join(dir, 'my\nfile.md'), 'newline')
	await exec_file('git', ['add', '-A'], {cwd: dir})

	const manifest = await build_manifest_from_git_staged(dir)

	assert.deepStrictEqual(
		manifest.map(e => e.source_name),
		['SKILL.md', 'my\nfile.md', 'my file.md', 'résumé.md'],
	)
	assert.strictEqual(manifest[1].target_content, 'newline')
	assert.strictEqual(manifest[2].target_content, 'spaced')
	assert.strictEqual(manifest[3].target_content, 'unicode')
})

// ** Exclusions

// No counterpart for "excludes ignored files":
// ignored files cannot normally be staged without `git add -f`; no useful test.

// No counterpart for "includes files in untracked subdirectory":
// untracked files are not in the index.
