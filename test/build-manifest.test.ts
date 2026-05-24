// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {build_manifest} from '../src/manifest.ts'
import {make_tmp_dir} from './helpers.ts'

// * build_manifest
// The orchestrator's happy path (MANIFEST_COMMAND override + 4-kind git dispatch) is covered
// through deploy/lint integration tests.  These two unit tests cover the two `throw` lines
// that fire when `detect_git` returns 'no-repo' or 'no-git'.

test('build_manifest: throws "not a git repository" outside a git repo', async () => {
	const dir = await make_tmp_dir()
	// no .env, no git init: read_manifest_command returns undefined, detect_git returns
	// 'no-repo', build_manifest throws.

	await assert.rejects(
		build_manifest(dir, {kind: 'clean'}),
		{message: 'not a git repository; run `git init` or set MANIFEST_COMMAND in .env'},
	)
})

test('build_manifest: throws "git not found" when git binary is not in PATH', async () => {
	const dir = await make_tmp_dir()
	const prev_path = process.env.PATH
	process.env.PATH = ''
	try {
		await assert.rejects(
			build_manifest(dir, {kind: 'clean'}),
			{
				message:
					'git not found; install git and run `git init`, or set MANIFEST_COMMAND in .env',
			},
		)
	} finally {
		process.env.PATH = prev_path
	}
})
