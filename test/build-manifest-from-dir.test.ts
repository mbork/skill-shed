// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {build_manifest_from_dir} from '../src/manifest.ts'
import {make_tmp_dir} from './helpers.ts'

// * build_manifest_from_dir

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
