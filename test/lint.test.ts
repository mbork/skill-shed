// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {run_lint, make_skill_dir} from './helpers.ts'

// Minimal valid frontmatter for a skill dir named "my-skill" (the default from make_skill_dir).
const FRONTMATTER = [
	'---',
	'name: my-skill',
	'description: Test skill.',
	'---',
	'',
	'',
].join('\n')

// * lint

// ** SKILL.md existence

test('lint: missing SKILL.md and SKILL.source.md is an error', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'helper.ts'), '// helper\n')

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stdout, /error: no file targets SKILL\.md/)
})

test('lint: SKILL.md present — no errors', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + '# My Skill\n')

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), '')
})

test('lint: SKILL.source.md present — no errors', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), FRONTMATTER + '# My Skill\n')

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), '')
})

// ** Conflict detection

test('lint: conflicting source files is an error — one error per conflicting group', async () => {
	const skill_dir = await make_skill_dir()
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
	const skill_dir = await make_skill_dir()
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
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
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
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), FRONTMATTER + [
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

// ** Unclosed fenced code blocks

test('lint: unclosed ``` fence in SKILL.source.md is an error with source line number', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), [
		'# Skill',
		'',
		'```',
		'body',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stdout, /SKILL\.source\.md:3: error: unclosed fenced code block/)
})

test('lint: unclosed ~~~ fence in SKILL.source.md is an error with source line number', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), [
		'# Skill',
		'',
		'~~~',
		'body',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stdout, /SKILL\.source\.md:3: error: unclosed fenced code block/)
})

test('lint: unclosed fence in a plain .md file is an error with line number', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# Skill\n')
	await writeFile(join(skill_dir, 'extra.md'), [
		'# Extra',
		'',
		'```',
		'body',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stdout, /extra\.md:3: error: unclosed fenced code block/)
})

test('lint: closed fence in SKILL.source.md is not an error', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), FRONTMATTER + [
		'# Skill',
		'',
		'```',
		'body',
		'```',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), '')
})

test('lint: multiple closed fences in SKILL.source.md is not an error', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), FRONTMATTER + [
		'# Skill',
		'',
		'```',
		'first',
		'```',
		'',
		'~~~',
		'second',
		'~~~',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), '')
})

test('lint: multiple fences with the last one unclosed — reports the last opener line', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), [
		'# Skill',
		'',
		'```',
		'first',
		'```',
		'',
		'```',
		'second',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stdout, /SKILL\.source\.md:7: error: unclosed fenced code block/)
})

test('lint: 4-backtick opener followed by 3-backtick closer is unclosed', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), [
		'# Skill',
		'',
		'````',
		'body',
		'```',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stdout, /SKILL\.source\.md:3: error: unclosed fenced code block/)
})

test('lint: fence opener inside a stripped HTML comment in .source.md is NOT flagged', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), FRONTMATTER + [
		'# Skill',
		'',
		'<!--',
		'```',
		'body',
		'-->',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), '')
})

test('lint: unclosed fence AFTER a stripped comment in .source.md reports the source line', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), [
		'# Skill',
		'',
		'<!--',
		'stripped comment',
		'-->',
		'',
		'```',
		'body',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 1)
	// Fence opener is on source line 7 (1-based), even though target line is smaller
	// because the stripped comment reduces target line count.
	assert.match(result.stdout, /SKILL\.source\.md:7: error: unclosed fenced code block/)
})

test('lint: unclosed fence in SKILL.md (plain .md) is an error — not special-cased', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), [
		'# Skill',
		'',
		'```',
		'body',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stdout, /SKILL\.md:3: error: unclosed fenced code block/)
})

test('lint: unclosed fence inside an HTML comment in a plain .md file is reported', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# Skill\n')
	// .md files are NOT comment-stripped, so the fence opener is visible to the tracker.
	await writeFile(join(skill_dir, 'extra.md'), [
		'# Extra',
		'<!--',
		'```',
		'body',
		'-->',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stdout, /extra\.md:3: error: unclosed fenced code block/)
})

// ** Frontmatter validation

test('lint: SKILL.md with no frontmatter is an error', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# My Skill\n')

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.strictEqual(
		result.stdout,
		'SKILL.md:0: error: SKILL.md has no frontmatter '
		+ '(see https://agentskills.io/specification#frontmatter)\n',
	)
})

test('lint: SKILL.source.md with no frontmatter is an error', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), '# My Skill\n')

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.strictEqual(
		result.stdout,
		'SKILL.source.md:0: error: SKILL.source.md has no frontmatter '
		+ '(see https://agentskills.io/specification#frontmatter)\n',
	)
})

test('lint: SKILL.md with non-mapping YAML frontmatter is an error', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), [
		'---',
		'- a',
		'- b',
		'---',
		'# My Skill',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.strictEqual(
		result.stdout,
		'SKILL.md:0: error: frontmatter error: frontmatter must be a YAML mapping '
		+ '(see https://agentskills.io/specification#frontmatter)\n',
	)
})

test('lint: SKILL.md missing required field "name" is an error', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), [
		'---',
		'description: Test skill.',
		'---',
		'# My Skill',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.strictEqual(
		result.stdout,
		'SKILL.md:0: error: name: required field is missing '
		+ '(see https://agentskills.io/specification#frontmatter)\n',
	)
})

test('lint: SKILL.md missing required field "description" is an error', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), [
		'---',
		'name: my-skill',
		'---',
		'# My Skill',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.strictEqual(
		result.stdout,
		'SKILL.md:0: error: description: required field is missing '
		+ '(see https://agentskills.io/specification#frontmatter)\n',
	)
})

test('lint: SKILL.md with name not matching dir is an error', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), [
		'---',
		'name: wrong-name',
		'description: Test skill.',
		'---',
		'# My Skill',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.strictEqual(
		result.stdout,
		'SKILL.md:2: error: name: "wrong-name" does not match skill directory name "my-skill" '
		+ '(see https://agentskills.io/specification#frontmatter)\n',
	)
})

test('lint: SKILL.md with unknown field near a known one emits a warning', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), [
		'---',
		'name: my-skill',
		'description: Test skill.',
		'licence: MIT',
		'---',
		'# My Skill',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(
		result.stdout,
		'SKILL.md:4: warning: unknown field "licence" (did you mean "license"?) '
		+ '(see https://agentskills.io/specification#frontmatter)\n',
	)
})
