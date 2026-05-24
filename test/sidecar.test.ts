// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {chmod, mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {
	SIDECAR_FILENAME,
	collect_overwrite_violations,
	collect_stale_violations,
	find_stale_names,
	hash_content,
	read_sidecar,
} from '../src/sidecar.ts'
import {make_tmp_dir} from './helpers.ts'

// * read_sidecar

test('read_sidecar: non-ENOENT error from readFile is rethrown', async () => {
	const target_dir = await make_tmp_dir()
	// Sidecar path is a directory: readFile throws EISDIR, which is not ENOENT.
	await mkdir(join(target_dir, SIDECAR_FILENAME))

	await assert.rejects(read_sidecar(target_dir), /EISDIR/)
})

// * collect_overwrite_violations

test('collect_overwrite_violations: non-ENOENT error from stat is rethrown', async () => {
	const target_dir = await make_tmp_dir()
	await mkdir(join(target_dir, 'sub'))
	await writeFile(join(target_dir, 'sub', 'foo.md'), 'x')
	await chmod(join(target_dir, 'sub'), 0o000)
	try {
		await assert.rejects(
			collect_overwrite_violations(
				[{
					source_name: 'foo.md',
					target_name: 'sub/foo.md',
					source_content: 'x',
					target_content: 'x',
				}],
				target_dir,
				{version: 1, files: {}},
			),
			/EACCES/,
		)
	} finally {
		await chmod(join(target_dir, 'sub'), 0o755)
	}
})

// * collect_stale_violations

test('collect_stale_violations: ENOENT (file already gone) is swallowed', async () => {
	const target_dir = await make_tmp_dir()
	// "reference.md" is in the sidecar but no file exists at target_dir/reference.md.
	const sidecar = {version: 1, files: {'reference.md': hash_content('something')}}

	const violations = await collect_stale_violations(['reference.md'], target_dir, sidecar)

	assert.deepStrictEqual(violations, [])
})

test('collect_stale_violations: non-ENOENT error from readFile is rethrown', async () => {
	const target_dir = await make_tmp_dir()
	await mkdir(join(target_dir, 'sub'))
	await writeFile(join(target_dir, 'sub', 'foo.md'), 'x')
	await chmod(join(target_dir, 'sub'), 0o000)
	try {
		await assert.rejects(
			collect_stale_violations(
				['sub/foo.md'],
				target_dir,
				{version: 1, files: {'sub/foo.md': hash_content('x')}},
			),
			/EACCES/,
		)
	} finally {
		await chmod(join(target_dir, 'sub'), 0o755)
	}
})

// * find_stale_names

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
