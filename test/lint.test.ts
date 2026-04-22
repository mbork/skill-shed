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

test('lint: SKILL.source.md present — no errors', async () => {
	const skill_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), '# My Skill\n')

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

// ** Unclosed HTML comments

test('lint: unclosed HTML comment in SKILL.source.md is an error with line number', async () => {
	const skill_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), [
		'# Skill',
		'',
		'<!-- unclosed',
		'',
		'some text',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stdout, /SKILL\.source\.md:3: error: unclosed HTML comment/)
})

test('lint: unclosed HTML comment in SKILL.md is silently accepted', async () => {
	const skill_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), [
		'# Skill',
		'',
		'<!-- unclosed',
		'',
		'some text',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), '')
})

test('lint: closed HTML comment in SKILL.source.md is not an error', async () => {
	const skill_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), [
		'# Skill',
		'',
		'<!-- comment -->',
		'',
		'some text',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), '')
})
