// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {writeFile, mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {build_manifest_from_command} from '../src/manifest.ts'
import {make_tmp_dir} from './helpers.ts'

// * build_manifest_from_command

test('build_manifest_from_command: returns entries for files listed by command', async () => {
	const dir = await make_tmp_dir()
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await writeFile(join(dir, 'extra.md'), 'world')

	const manifest = await build_manifest_from_command(dir, 'printf "SKILL.md\\nextra.md\\n"')

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md', 'extra.md'])
	assert.strictEqual(manifest[0].target_content, 'hello')
	assert.strictEqual(manifest[1].target_content, 'world')
})

test('build_manifest_from_command: normalizes ./ prefix from command output', async () => {
	const dir = await make_tmp_dir()
	await writeFile(join(dir, 'SKILL.md'), 'hello')

	const manifest = await build_manifest_from_command(dir, 'printf \'./SKILL.md\\n\'')

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md'])
})

test('build_manifest_from_command: strips HTML comments from .source.md files', async () => {
	const dir = await make_tmp_dir()
	await writeFile(join(dir, 'SKILL.source.md'), '# Hello\n<!-- comment -->\nworld')

	const manifest = await build_manifest_from_command(dir, 'printf \'SKILL.source.md\\n\'')

	assert.strictEqual(manifest[0].target_name, 'SKILL.md')
	assert.strictEqual(manifest[0].source_content, '# Hello\n<!-- comment -->\nworld')
	assert.strictEqual(manifest[0].target_content, '# Hello\nworld')
})

test('build_manifest_from_command: entries are sorted by source_name', async () => {
	const dir = await make_tmp_dir()
	await writeFile(join(dir, 'SKILL.md'), '')
	await writeFile(join(dir, 'zebra.txt'), '')
	await writeFile(join(dir, 'alpha.txt'), '')

	const manifest = await build_manifest_from_command(
		dir,
		'printf \'zebra.txt\\nSKILL.md\\nalpha.txt\\n\'',
	)

	assert.deepStrictEqual(
		manifest.map(e => e.source_name),
		['SKILL.md', 'alpha.txt', 'zebra.txt'],
	)
})

test('build_manifest_from_command: throws with MANIFEST_COMMAND failed prefix when command not found', async () => {
	const dir = await make_tmp_dir()

	await assert.rejects(
		() => build_manifest_from_command(dir, 'nonexistent-skill-shed-cmd-xyz'),
		/MANIFEST_COMMAND failed/,
	)
})

test('build_manifest_from_command: throws with MANIFEST_COMMAND failed prefix when command exits non-zero', async () => {
	const dir = await make_tmp_dir()

	await assert.rejects(
		() => build_manifest_from_command(dir, 'exit 1'),
		/MANIFEST_COMMAND failed/,
	)
})

test('build_manifest_from_command: works with files in subdirectories', async () => {
	const dir = await make_tmp_dir()
	await writeFile(join(dir, 'SKILL.md'), 'skill')
	await mkdir(join(dir, 'examples'))
	await writeFile(join(dir, 'examples', 'demo.md'), 'demo')

	const manifest = await build_manifest_from_command(
		dir,
		'printf \'SKILL.md\\nexamples/demo.md\\n\'',
	)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md', 'examples/demo.md'])
	assert.strictEqual(manifest[1].target_content, 'demo')
})

test('build_manifest_from_command: works with an absolute-path command', async () => {
	const dir = await make_tmp_dir()
	await writeFile(join(dir, 'SKILL.md'), 'hello')

	// /bin/sh is always available; use it to echo a filename
	const manifest = await build_manifest_from_command(
		dir,
		'/bin/sh -c "printf \'SKILL.md\\n\'"',
	)

	assert.deepStrictEqual(manifest.map(e => e.source_name), ['SKILL.md'])
})
