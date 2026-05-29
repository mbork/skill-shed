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
		'# A',
		'## B',
		'## C',
		'body.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, 'SKILL.md:7: warning: empty section "B"\n')
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

test('lint: empty-titled heading at EOF emits both empty-section and empty-title warnings',
	async () => {
		const skill_dir = await make_skill_dir()
		await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + '# \n')

		const result = await run_lint(skill_dir)

		assert.strictEqual(result.code, 0)
		assert.strictEqual(result.stdout, [
			'SKILL.md:6: warning: empty section ""',
			'SKILL.md:6: warning: empty heading title',
			'',
		].join('\n'))
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
	assert.strictEqual(result.stdout, [
		'SKILL.md:6: warning: empty section "A"',
		'SKILL.md:7: warning: empty section "B"',
		'SKILL.md:8: warning: empty section "C"',
		'',
	].join('\n'))
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

test('lint: non-SKILL.md file starting with `---` is not skipped as frontmatter', async () => {
	// A leading `---` in a non-SKILL.md file is a Markdown horizontal rule, not a
	// frontmatter delimiter.  Heading checks must see the content before the matching
	// `---` (and the matching `---` itself) rather than skipping past them.  Without the
	// fix, body_start would jump to line 4, hiding `# Aqq` from the checks — `### Bęc`
	// would then be reported as "first heading is level 3, expected level 1".  With the
	// fix, `# Aqq` is visible and `### Bęc` correctly fires the skipped-level warning.
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + '# Skill\n\nBody.\n')
	await writeFile(join(skill_dir, 'reference.md'), [
		'---',
		'# Aqq',
		'---',
		'### Bęc',
		'body.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(
		result.stdout,
		'reference.md:4: warning: heading level 3 follows level 1, skipping 2\n',
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
	assert.strictEqual(result.stdout, [
		'SKILL.md:0: error: frontmatter error: unclosed frontmatter (no closing --- or ...) '
		+ '(see https://agentskills.io/specification#frontmatter)',
		'SKILL.md:4: warning: body is empty',
		'',
	].join('\n'))
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
		assert.strictEqual(result.stdout, [
			'SKILL.md:0: error: SKILL.md has no frontmatter '
			+ '(see https://agentskills.io/specification#frontmatter)',
			'SKILL.md:1: warning: body is empty',
			'',
		].join('\n'))
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

// ** Empty heading titles

test('lint: heading with no title and a hash only is a warning', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'#',
		'',
		'body.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, 'SKILL.md:6: warning: empty heading title\n')
})

test('lint: title-less heading followed by content emits only the empty-title warning',
	async () => {
		const skill_dir = await make_skill_dir()
		await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
			'# ',
			'body.',
			'',
		].join('\n'))

		const result = await run_lint(skill_dir)

		assert.strictEqual(result.code, 0)
		assert.strictEqual(result.stdout, 'SKILL.md:6: warning: empty heading title\n')
	})

test('lint: level-2 empty title is flagged', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# Skill',
		'',
		'## ',
		'sub-body.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, 'SKILL.md:8: warning: empty heading title\n')
})

test('lint: heading whose title is only whitespace is flagged', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'#  \t ',
		'body.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, 'SKILL.md:6: warning: empty heading title\n')
})

test('lint: heading with a real title is not flagged', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# Title',
		'body.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), '')
})

test('lint: `#` line inside a fenced code block is not flagged', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# Skill',
		'',
		'```',
		'#',
		'```',
		'',
		'body.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), '')
})

test('lint: empty-title warning in .source.md reports the source line via line_map',
	async () => {
		const skill_dir = await make_skill_dir()
		await writeFile(join(skill_dir, 'SKILL.source.md'), [
			'---',
			'name: my-skill',
			'description: Test skill.',
			'---',
			'',
			'<!-- a comment, stripped -->',
			'',
			'# ',
			'body.',
			'',
		].join('\n'))

		const result = await run_lint(skill_dir)

		assert.strictEqual(result.code, 0)
		assert.strictEqual(result.stdout, 'SKILL.source.md:8: warning: empty heading title\n')
	})

// ** Duplicate headings

test('lint: two sibling headings with the same title produce a warning on the second',
	async () => {
		const skill_dir = await make_skill_dir()
		await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
			'# Aqq',
			'body.',
			'',
			'# Aqq',
			'body.',
			'',
		].join('\n'))

		const result = await run_lint(skill_dir)

		assert.strictEqual(result.code, 0)
		assert.strictEqual(
			result.stdout,
			'SKILL.md:9: warning: duplicate heading "Aqq" (also at line 6)\n',
		)
	})

test('lint: three sibling duplicates emit two warnings, both pointing at the first',
	async () => {
		const skill_dir = await make_skill_dir()
		await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
			'# Aqq',
			'a.',
			'# Aqq',
			'b.',
			'# Aqq',
			'c.',
			'',
		].join('\n'))

		const result = await run_lint(skill_dir)

		assert.strictEqual(result.code, 0)
		assert.strictEqual(result.stdout, [
			'SKILL.md:8: warning: duplicate heading "Aqq" (also at line 6)',
			'SKILL.md:10: warning: duplicate heading "Aqq" (also at line 6)',
			'',
		].join('\n'))
	})

test('lint: a subsection with the same title as its parent heading is flagged as ancestor duplicate',
	async () => {
		const skill_dir = await make_skill_dir()
		await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
			'# Skill',
			'',
			'## Aqq',
			'a.',
			'### Aqq',
			'b.',
			'',
		].join('\n'))

		const result = await run_lint(skill_dir)

		assert.strictEqual(result.code, 0)
		assert.strictEqual(
			result.stdout,
			'SKILL.md:10: warning: heading "Aqq" duplicates an ancestor (also at line 8)\n',
		)
	})

// Level skip: `### Aqq`'s direct parent is `# Parent` (no level-2 ancestor), and `## Aqq`'s
// direct parent is also `# Parent`.  Both share `# Parent` as the direct parent but differ in
// level, so the duplicate key (`${level}|${text}`) is different and no warning fires.
test('lint: same title at different levels under the same parent is not a duplicate',
	async () => {
		// The level-3 / level-2 mix under # Parent is the only way to put two
		// differently-leveled headings under one parent; the inevitable skipped-level
		// warning on `### Aqq` is incidental to what this test asserts.
		const skill_dir = await make_skill_dir()
		await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
			'# Parent',
			'',
			'### Aqq',
			'a.',
			'',
			'## Aqq',
			'b.',
			'',
		].join('\n'))

		const result = await run_lint(skill_dir)

		assert.strictEqual(result.code, 0)
		assert.strictEqual(
			result.stdout,
			'SKILL.md:8: warning: heading level 3 follows level 1, skipping 2\n',
		)
	})

test('lint: sibling duplicate with intervening same-level sibling is still flagged',
	async () => {
		const skill_dir = await make_skill_dir()
		await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
			'# Skill',
			'',
			'## Aqq',
			'a.',
			'',
			'## Bum',
			'b.',
			'',
			'## Aqq',
			'c.',
			'',
		].join('\n'))

		const result = await run_lint(skill_dir)

		assert.strictEqual(result.code, 0)
		assert.strictEqual(
			result.stdout,
			'SKILL.md:14: warning: duplicate heading "Aqq" (also at line 8)\n',
		)
	})

test('lint: same title under different parents is not a duplicate', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# Tool A',
		'',
		'## Examples',
		'a.',
		'',
		'# Tool B',
		'',
		'## Examples',
		'b.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), '')
})

test('lint: duplicate detection is case-sensitive', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# Aqq',
		'a.',
		'# aqq',
		'b.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), '')
})

test('lint: trailing-`#` closing sequence does not break duplicate detection', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# Aqq',
		'a.',
		'# Aqq ###',
		'b.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(
		result.stdout,
		'SKILL.md:8: warning: duplicate heading "Aqq" (also at line 6)\n',
	)
})

test('lint: heading-shaped lines inside a fenced code block do not count', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# Aqq',
		'',
		'```',
		'# Aqq',
		'```',
		'',
		'body.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), '')
})

test('lint: sibling duplicate with intervening subsection is still flagged', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# Skill',
		'',
		'## Aqq',
		'',
		'### Bęc',
		'a.',
		'',
		'## Aqq',
		'b.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(
		result.stdout,
		'SKILL.md:13: warning: duplicate heading "Aqq" (also at line 8)\n',
	)
})

test('lint: empty-titled duplicate headings do not produce a duplicate warning', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# ',
		'a.',
		'# ',
		'b.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, [
		'SKILL.md:6: warning: empty heading title',
		'SKILL.md:8: warning: empty heading title',
		'',
	].join('\n'))
})

test('lint: ancestor match reports the outermost matching ancestor when multiple match',
	async () => {
		// Three nested headings with the same title: both `## Aqq` and `### Aqq` should
		// report the outermost `# Aqq` — the root of the duplication chain.
		const skill_dir = await make_skill_dir()
		await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
			'# Aqq',
			'a.',
			'',
			'## Aqq',
			'b.',
			'',
			'### Aqq',
			'c.',
			'',
		].join('\n'))

		const result = await run_lint(skill_dir)

		assert.strictEqual(result.code, 0)
		assert.strictEqual(result.stdout, [
			'SKILL.md:9: warning: heading "Aqq" duplicates an ancestor (also at line 6)',
			'SKILL.md:12: warning: heading "Aqq" duplicates an ancestor (also at line 6)',
			'',
		].join('\n'))
	})

test('lint: sibling duplicate and ancestor match fire together on the same line', async () => {
	// `# Aqq / ## Aqq / ## Aqq`: the second `## Aqq` is both a sibling-duplicate of the first
	// `## Aqq` AND nested under the same-titled `# Aqq`.  Both warnings fire on the same line.
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# Aqq',
		'',
		'## Aqq',
		'a.',
		'',
		'## Aqq',
		'b.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, [
		'SKILL.md:8: warning: heading "Aqq" duplicates an ancestor (also at line 6)',
		'SKILL.md:11: warning: duplicate heading "Aqq" (also at line 8)',
		'SKILL.md:11: warning: heading "Aqq" duplicates an ancestor (also at line 6)',
		'',
	].join('\n'))
})

test('lint: non-direct ancestor with non-matching intermediate is flagged', async () => {
	// `# Aqq / ## Bęc / ### Aqq`: the intermediate `## Bęc` does not match, but the outer
	// `# Aqq` does — the nearest matching ancestor is the grandparent, two levels up.
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# Aqq',
		'',
		'## Bęc',
		'',
		'### Aqq',
		'body.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(
		result.stdout,
		'SKILL.md:10: warning: heading "Aqq" duplicates an ancestor (also at line 6)\n',
	)
})

test('lint: ancestor match across a level skip', async () => {
	// `# Aqq / ### Aqq` (no level 2 between): the ### heading's nearest ancestor is the # one,
	// which they match.  The level skip on `### Aqq` is incidental — both warnings fire on
	// the same line.
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# Aqq',
		'',
		'### Aqq',
		'body.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, [
		'SKILL.md:8: warning: heading "Aqq" duplicates an ancestor (also at line 6)',
		'SKILL.md:8: warning: heading level 3 follows level 1, skipping 2',
		'',
	].join('\n'))
})

test('lint: duplicate-heading warning in .source.md reports source lines via line_map',
	async () => {
		const skill_dir = await make_skill_dir()
		await writeFile(join(skill_dir, 'SKILL.source.md'), FRONTMATTER + [
			'<!-- a comment, stripped -->',
			'',
			'# Aqq',
			'a.',
			'',
			'# Aqq',
			'b.',
			'',
		].join('\n'))

		const result = await run_lint(skill_dir)

		assert.strictEqual(result.code, 0)
		assert.strictEqual(
			result.stdout,
			'SKILL.source.md:11: warning: duplicate heading "Aqq" (also at line 8)\n',
		)
	})

test('lint: ancestor-match warning in .source.md reports the ancestor line via line_map',
	async () => {
		const skill_dir = await make_skill_dir()
		await writeFile(join(skill_dir, 'SKILL.source.md'), FRONTMATTER + [
			'<!-- a comment, stripped -->',
			'',
			'# Aqq',
			'a.',
			'',
			'## Aqq',
			'b.',
			'',
		].join('\n'))

		const result = await run_lint(skill_dir)

		assert.strictEqual(result.code, 0)
		assert.strictEqual(
			result.stdout,
			'SKILL.source.md:11: warning: heading "Aqq" duplicates an ancestor (also at line 8)\n',
		)
	})

// ** Skipped heading levels

test('lint: first heading at level 2 warns', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'## Aqq',
		'body.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(
		result.stdout,
		'SKILL.md:6: warning: first heading is level 2, expected level 1\n',
	)
})

test('lint: single skipped level reports the bare level number', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# Aqq',
		'',
		'### Bęc',
		'body.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(
		result.stdout,
		'SKILL.md:8: warning: heading level 3 follows level 1, skipping 2\n',
	)
})

test('lint: multiple skipped levels report a compact range', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# Aqq',
		'',
		'##### Bęc',
		'body.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(
		result.stdout,
		'SKILL.md:8: warning: heading level 5 follows level 1, skipping 2-4\n',
	)
})

test('lint: skip is detected against the most recent heading regardless of branch', async () => {
	// # A / ## B / # C / ### D: D's predecessor is C (level 1), so D (level 3) skips level 2.
	// The fact that an earlier branch had a level-2 heading is irrelevant.
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# Aqq',
		'',
		'## Bęc',
		'b.',
		'',
		'# Bum',
		'',
		'### Trach',
		'd.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(
		result.stdout,
		'SKILL.md:13: warning: heading level 3 follows level 1, skipping 2\n',
	)
})

test('lint: valid heading sequence 1->2->3->2->1 produces no warnings', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# Aqq',
		'',
		'## Bęc',
		'',
		'### Bum',
		'bum.',
		'',
		'## Trach',
		'trach.',
		'',
		'# Aqq2',
		'aqq2.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, '')
})

test('lint: jumping down by more than one level does not warn on the lower heading', async () => {
	// Reach level 3 via a clean 1->2->3 lead-in so this test isolates the down-jump
	// semantic only.  # Trach drops two levels (3 -> 1); going down is always silent
	// regardless of distance.
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# Aqq',
		'',
		'## Bęc',
		'',
		'### Bum',
		'bum body.',
		'',
		'# Trach',
		'trach body.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, '')
})

test('lint: empty-titled first heading at level 2 fires both warnings on the same line',
	async () => {
		const skill_dir = await make_skill_dir()
		await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
			'## ',
			'body.',
			'',
		].join('\n'))

		const result = await run_lint(skill_dir)

		assert.strictEqual(result.code, 0)
		assert.strictEqual(result.stdout, [
			'SKILL.md:6: warning: empty heading title',
			'SKILL.md:6: warning: first heading is level 2, expected level 1',
			'',
		].join('\n'))
	})

test('lint: empty-titled heading counts as predecessor for level tracking', async () => {
	// # Aqq, ### (empty), ### Bęc: the empty ### takes the skipped-level warning; the
	// titled ### that follows is at the same level as its predecessor, so it is silent.
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
		'# Aqq',
		'',
		'### ',
		'empty body.',
		'',
		'### Bęc',
		'bęc body.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, [
		'SKILL.md:8: warning: empty heading title',
		'SKILL.md:8: warning: heading level 3 follows level 1, skipping 2',
		'',
	].join('\n'))
})

test('lint: heading-like line inside a fenced code block does not trigger skipped-level',
	async () => {
		const skill_dir = await make_skill_dir()
		await writeFile(join(skill_dir, 'SKILL.md'), FRONTMATTER + [
			'# Aqq',
			'',
			'```',
			'### not a heading',
			'```',
			'',
		].join('\n'))

		const result = await run_lint(skill_dir)

		assert.strictEqual(result.code, 0)
		assert.strictEqual(result.stdout, '')
	})

test('lint: skipped-level warning in .source.md reports source lines via line_map', async () => {
	const skill_dir = await make_skill_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), FRONTMATTER + [
		'<!-- a comment, stripped -->',
		'',
		'# Aqq',
		'',
		'### Bęc',
		'body.',
		'',
	].join('\n'))

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(
		result.stdout,
		'SKILL.source.md:10: warning: heading level 3 follows level 1, skipping 2\n',
	)
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

// ** SKILL.md body length

test('lint: SKILL.md body of exactly 20000 chars is silent (boundary)', async () => {
	// Trailing empty array element produces a final `\n` (real-file convention); body
	// length is measured after `.trim()`, so the trailing newline does not push us over.
	const skill_dir = await make_skill_dir()
	const content = [
		'---',
		'name: my-skill',
		'description: Test skill.',
		'---',
		'a'.repeat(20000),
		'',
	].join('\n')
	await writeFile(join(skill_dir, 'SKILL.md'), content)

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, '')
})

test('lint: SKILL.md body of 20001 chars warns with full message', async () => {
	const skill_dir = await make_skill_dir()
	const content = [
		'---',
		'name: my-skill',
		'description: Test skill.',
		'---',
		'a'.repeat(20001),
		'',
	].join('\n')
	await writeFile(join(skill_dir, 'SKILL.md'), content)

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(
		result.stdout,
		'SKILL.md:5: warning: body length (20001 chars) exceeds the 20000-character '
		+ 'recommended maximum (~5000 tokens at 4 chars/token); '
		+ 'see https://agentskills.io/specification#progressive-disclosure\n',
	)
})

test('lint: body length is measured after trim (surrounding whitespace does not count)',
	async () => {
		// Raw body is ~20200 chars (100 leading newlines + 20000 a's + 100 trailing
		// newlines), but after `.trim()` it is 20000 chars → silent.  Locks in the trim
		// semantic so a future change to "measure raw chars" would be caught here.
		const skill_dir = await make_skill_dir()
		const padding = '\n'.repeat(100)
		const content = [
			'---',
			'name: my-skill',
			'description: Test skill.',
			'---',
			padding + 'a'.repeat(20000) + padding,
		].join('\n')
		await writeFile(join(skill_dir, 'SKILL.md'), content)

		const result = await run_lint(skill_dir)

		assert.strictEqual(result.code, 0)
		assert.strictEqual(result.stdout, '')
	})

test('lint: SKILL.source.md body-length warning reports the source line via line_map',
	async () => {
		// Triggers the warning on a .source.md so the line_map lookup is exercised (the
		// SKILL.md case above hits the `?? body_start` fallback because line_map is
		// undefined for .md files).
		const skill_dir = await make_skill_dir()
		const content = FRONTMATTER + '<!-- a comment, stripped -->\n' + 'a'.repeat(20001) + '\n'
		await writeFile(join(skill_dir, 'SKILL.source.md'), content)

		const result = await run_lint(skill_dir)

		assert.strictEqual(result.code, 0)
		assert.match(
			result.stdout,
			/^SKILL\.source\.md:\d+: warning: body length \(20001 chars\) exceeds /,
		)
	})

test('lint: SKILL.source.md body length is computed on stripped content', async () => {
	// Dramatic ratio: a 30000-char HTML comment (well above the 20000 threshold) plus a
	// tiny real body.  If the check operated on source_content instead of target_content,
	// it would trip on the comment.  Silent verifies that the strip pipeline's output
	// (target_content) is what gets measured.
	const skill_dir = await make_skill_dir()
	const huge_comment = `<!-- ${'x'.repeat(30000)} -->`
	const real_body = '# Skill\n\nA tiny body.\n'
	await writeFile(join(skill_dir, 'SKILL.source.md'), FRONTMATTER + huge_comment + '\n' + real_body)

	const result = await run_lint(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout, '')
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
