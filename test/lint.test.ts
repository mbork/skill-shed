// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {run_lint, make_tmp_dir} from './helpers.ts'

// * lint

// ** SKILL.md existence

test('lint: missing SKILL.md and SKILL.source.md is an error', async () => {
	const skill_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'helper.ts'), '// helper\n')

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stdout, /error: no file targets SKILL\.md/)
})

test('lint: SKILL.md present — no errors', async () => {
	const skill_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# My Skill\n')

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), '')
})

// ** Conflict detection

test('lint: conflicting source files is an error — one error per conflicting group', async () => {
	const skill_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# My Skill\n')
	await writeFile(join(skill_dir, 'SKILL.source.md'), '# My Skill\n')
	await writeFile(join(skill_dir, 'reference.md'), '# Ref\n')
	await writeFile(join(skill_dir, 'reference.source.md'), '# Ref\n')

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stdout, /error: conflicting source files: SKILL\.md, SKILL\.source\.md/)
	assert.match(result.stdout, /error: conflicting source files: reference\.md, reference\.source\.md/)
})

test('lint: SKILL.source.md present — no errors', async () => {
	const skill_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), '# My Skill\n')

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), '')
})
