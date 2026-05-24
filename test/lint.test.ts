// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {run_lint, make_skill_dir, run_script, setup_git, git_commit} from './helpers.ts'

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
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + '# My Skill\n\nBody.\n')

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), '')
})

test('lint: SKILL.source.md present — no errors', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), FRONTMATTER + '# My Skill\n\nBody.\n')

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
	// "After the comment." is required so that `# Skill` is not flagged as an empty section
	// post-stripping.  The test's primary subject is the fence-in-comment behavior.
	await writeFile(join(skill_dir, 'SKILL.source.md'), FRONTMATTER + [
		'# Skill',
		'',
		'<!--',
		'```',
		'body',
		'-->',
		'',
		'After the comment.',
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
	await writeFile(join(skill_dir, 'SKILL.md'), '# My Skill\n\nBody.\n')

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
	await writeFile(join(skill_dir, 'SKILL.source.md'), '# My Skill\n\nBody.\n')

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
		'Body.',
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
		'Body.',
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
		'Body.',
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
		'Body.',
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
		'Body.',
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

// ** Empty sections

test('lint: `#`-prefixed YAML comments in frontmatter do not trigger empty-section warnings',
	async () => {
		const skill_dir = await make_skill_dir()
		await writeFile(join(skill_dir, 'SKILL.md'), [
			'---',
			'# first YAML comment',
			'# second YAML comment',
			'name: my-skill',
			'description: Test skill.',
			'---',
			'',
			'# Title',
			'',
			'Body.',
			'',
		].join('\n'))

		const result = await run_lint(skill_dir)

		assert.strictEqual(result.code, 0)
		assert.strictEqual(result.stdout.trim(), '')
	})

test('lint: heading with no body is a warning', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + '# Title\n')

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, 'SKILL.md:6: warning: empty section "Title"\n')
})

test('lint: heading followed by blank lines only is a warning', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + '# Title\n\n\n\n')

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, 'SKILL.md:6: warning: empty section "Title"\n')
})

test('lint: heading followed by sibling heading is a warning on the first only', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'## A',
		'## B',
		'body.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, 'SKILL.md:6: warning: empty section "A"\n')
})

test('lint: parent heading whose only content is a subsection is NOT flagged', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# A',
		'## B',
		'body.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), '')
})

test('lint: section that contains a code fence is NOT flagged', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# Title',
		'```',
		'x',
		'```',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), '')
})

// Two `#` lines inside the fence: if fence-awareness regressed, the first would be classified
// as a heading and the second as a same-level sibling closing it — a false-positive warning.
test('lint: consecutive `#` lines inside a fenced code block do not count as headings',
	async () => {
		const skill_dir = await make_skill_dir()
		await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
			'# Real',
			'',
			'```',
			'# fake1',
			'# fake2',
			'```',
			'',
			'body.',
			'',
		].join('\n'))

		const result = await run_lint(skill_dir)

		assert.strictEqual(result.code, 0)
		assert.strictEqual(result.stdout.trim(), '')
	})

test('lint: empty-section warning in .source.md reports the source line via line_map',
	async () => {
		const skill_dir = await make_skill_dir()
		await writeFile(join(skill_dir, 'SKILL.source.md'), [
			'---',
			'name: my-skill',
			'description: Test skill.',
			'---',
			'',
			'<!-- some comment -->',
			'',
			'# Title',
			'',
		].join('\n'))

		const result = await run_lint(skill_dir)

		assert.strictEqual(result.code, 0)
		assert.strictEqual(result.stdout, 'SKILL.source.md:8: warning: empty section "Title"\n')
	})

test('lint: section with only an HTML comment (stripped from .source.md) is flagged empty',
	async () => {
		const skill_dir = await make_skill_dir()
		await writeFile(join(skill_dir, 'SKILL.source.md'), [
			'---',
			'name: my-skill',
			'description: Test skill.',
			'---',
			'',
			'# Title',
			'<!-- a comment, stripped -->',
			'',
		].join('\n'))

		const result = await run_lint(skill_dir)

		assert.strictEqual(result.code, 0)
		assert.strictEqual(result.stdout, 'SKILL.source.md:6: warning: empty section "Title"\n')
	})

test('lint: 4-space-indented `# Title` does not count as a heading', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'    # Title',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), '')
})

test('lint: 7-hash line does not count as a heading', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'####### Not a heading',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), '')
})

test('lint: trailing-`#` closing sequence stripped from reported title', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + '# Title ###\n')

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, 'SKILL.md:6: warning: empty section "Title"\n')
})

test('lint: empty-titled heading produces `empty section ""`', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + '# \n')

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, 'SKILL.md:6: warning: empty section ""\n')
})

test('lint: multi-word title preserved in the warning text', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + '# A great section\n')

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, 'SKILL.md:6: warning: empty section "A great section"\n')
})

test('lint: multiple empty sections in one file produce multiple warnings', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# A',
		'# B',
		'# C',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(
		result.stdout,
		'SKILL.md:6: warning: empty section "A"\n'
		+ 'SKILL.md:7: warning: empty section "B"\n'
		+ 'SKILL.md:8: warning: empty section "C"\n',
	)
})

test('lint: empty section in a non-SKILL.md file is flagged', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + '# Skill\n\nBody.\n')
	await writeFile(join(skill_dir, 'reference.md'), '# Empty section\n')

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(
		result.stdout,
		'reference.md:1: warning: empty section "Empty section"\n',
	)
})

test('lint: unclosed frontmatter does not produce empty-section warnings', async () => {
	const skill_dir = await make_skill_dir()
	// No closing `---`: extract_frontmatter returns kind:'error' with body_start_line at EOF,
	// so check_no_empty_sections sees no body and emits no empty-section warning.  The
	// frontmatter error fires, and check_empty_body fires too (body region is empty).
	await writeFile(join(skill_dir, 'SKILL.md'), '---\n# heading\n')

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.strictEqual(
		result.stdout,
		'SKILL.md:0: error: frontmatter error: unclosed frontmatter (no closing --- or ...) '
		+ '(see https://agentskills.io/specification#frontmatter)\n'
		+ 'SKILL.md:4: warning: body is empty\n',
	)
})

test('lint: empty section after invalid-YAML frontmatter is still flagged', async () => {
	const skill_dir = await make_skill_dir()
	// Closed `---` delimiters but invalid YAML inside: body_start_line points just past the
	// closing ---, so the empty-section check still runs on the body and fires alongside
	// the frontmatter error.
	await writeFile(join(skill_dir, 'SKILL.md'), [
		'---',
		': bad: yaml:',
		'---',
		'',
		'# Empty',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.strictEqual(result.stdout, [
		'SKILL.md:5: warning: empty section "Empty"',
		'SKILL.md:0: error: frontmatter error: invalid YAML in frontmatter: '
		+ 'Nested mappings are not allowed in compact mappings at line 1, column 3:',
		'',
		': bad: yaml:',
		'  ^',
		'; Nested mappings are not allowed in compact mappings at line 1, column 8:',
		'',
		': bad: yaml:',
		'       ^',
		' (see https://agentskills.io/specification#frontmatter)',
		'',
	].join('\n'))
})

test('lint: `#hashtag` in body does not count as a heading', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# Section',
		'#hashtag is just text',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), '')
})

test('lint: consecutive `#` lines inside a tilde fence do not count as headings', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# Real',
		'',
		'~~~',
		'# fake1',
		'# fake2',
		'~~~',
		'',
		'body.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), '')
})

// ** Empty skill body

test('lint: SKILL.md with only frontmatter and no body is a warning', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER)

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, 'SKILL.md:5: warning: body is empty\n')
})

test('lint: SKILL.md body consisting only of whitespace is a warning', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + '   \n\t\n\n')

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, 'SKILL.md:5: warning: body is empty\n')
})

test('lint: SKILL.source.md whose body becomes empty after comment stripping is a warning',
	async () => {
		const skill_dir = await make_skill_dir()
		await writeFile(
			join(skill_dir, 'SKILL.source.md'),
			FRONTMATTER + '<!-- only a comment, stripped on deploy -->\n',
		)

		const result = await run_lint(skill_dir)

		assert.strictEqual(result.code, 0)
		assert.strictEqual(result.stdout, 'SKILL.source.md:5: warning: body is empty\n')
	})

test('lint: empty SKILL.md emits both the no-frontmatter error and the empty-body warning',
	async () => {
		const skill_dir = await make_skill_dir()
		await writeFile(join(skill_dir, 'SKILL.md'), '')

		const result = await run_lint(skill_dir)

		assert.strictEqual(result.code, 1)
		assert.strictEqual(
			result.stdout,
			'SKILL.md:0: error: SKILL.md has no frontmatter '
			+ '(see https://agentskills.io/specification#frontmatter)\n'
			+ 'SKILL.md:1: warning: body is empty\n',
		)
	})

test('lint: invalid YAML frontmatter with an empty body emits both the error and the warning',
	async () => {
		const skill_dir = await make_skill_dir()
		await writeFile(join(skill_dir, 'SKILL.md'), [
			'---',
			': bad: yaml:',
			'---',
			'',
		].join('\n'))

		const result = await run_lint(skill_dir)

		assert.strictEqual(result.code, 1)
		assert.match(result.stdout, /body is empty/)
	})

// ** Empty non-SKILL.md files

test('lint: empty non-SKILL.md file is a warning', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + '# Skill\n\nBody.\n')
	await writeFile(join(skill_dir, 'reference.md'), '')

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, 'reference.md:0: warning: file is empty\n')
})

test('lint: whitespace-only non-SKILL.md file is a warning', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + '# Skill\n\nBody.\n')
	await writeFile(join(skill_dir, 'reference.md'), '   \n\t\n\n')

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, 'reference.md:0: warning: file is empty\n')
})

test('lint: .source.md whose target is empty after stripping is a warning', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + '# Skill\n\nBody.\n')
	await writeFile(join(skill_dir, 'reference.source.md'), '<!-- only a comment -->\n')

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, 'reference.source.md:0: warning: file is empty\n')
})

test('lint: empty binary (non-.md) file is a warning', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + '# Skill\n\nBody.\n')
	await writeFile(join(skill_dir, 'asset.bin'), Buffer.alloc(0))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, 'asset.bin:0: warning: file is empty\n')
})

test('lint: empty SKILL.md reports body-empty, not file-empty', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '')

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.doesNotMatch(result.stdout, /file is empty/)
	assert.match(result.stdout, /body is empty/)
})

// ** Manifest source errors

test('lint: non-ENOENT error reading .env is reported via catch block', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + '# Skill\n\nBody.\n')
	await mkdir(join(skill_dir, '.env'))
	await setup_git(skill_dir)
	await git_commit(skill_dir)

	const result = await run_script(['lint', skill_dir])

	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /Error:.*EISDIR/)
})
