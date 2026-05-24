// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {chmod} from 'node:fs/promises'
import {detect_git} from '../src/utils.ts'
import {make_tmp_dir} from './helpers.ts'

// * detect_git
// Indirect coverage from integration tests only ever hits the 'ok' branch.  These three
// unit tests cover the catch branches: ENOENT → 'no-git', "not a git repository" stderr →
// 'no-repo', everything else → rethrow.

test('detect_git: returns "no-repo" outside a git repo', async () => {
	const dir = await make_tmp_dir()

	assert.strictEqual(await detect_git(dir), 'no-repo')
})

test('detect_git: returns "no-git" when git binary is not in PATH', async () => {
	const dir = await make_tmp_dir()
	const prev_path = process.env.PATH
	process.env.PATH = ''
	try {
		assert.strictEqual(await detect_git(dir), 'no-git')
	} finally {
		process.env.PATH = prev_path
	}
})

test('detect_git: rethrows uncategorized errors (e.g. unreadable cwd)', async () => {
	const dir = await make_tmp_dir()
	await chmod(dir, 0o000)
	try {
		await assert.rejects(detect_git(dir))
	} finally {
		await chmod(dir, 0o755)
	}
})
