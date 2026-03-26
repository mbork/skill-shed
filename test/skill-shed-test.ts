#!/usr/bin/env -S node --experimental-strip-types

// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp, writeFile, readFile, readdir, utimes} from 'node:fs/promises'
import {tmpdir, homedir} from 'node:os'
import {join, resolve, dirname, basename} from 'node:path'
import {fileURLToPath} from 'node:url'
import {strip_html_comments} from '../strip-html-comments.ts'
import {target_filename} from '../skill-shed.ts'
import {build_manifest_from_dir} from '../manifest.ts'

const exec_file = promisify(execFile)
const script = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'skill-shed.ts')

// * Helpers

interface Run_result {stdout: string, stderr: string, code: number}

async function run_init(skill_dir: string, deploy_dir?: string, flags: string[] = []): Promise<Run_result> {
	const extra_args = deploy_dir ? [deploy_dir] : []
	try {
		const result = await exec_file('node', [script, 'init', skill_dir, ...extra_args, ...flags])
		return {stdout: result.stdout, stderr: result.stderr, code: 0}
	} catch (e: unknown) {
		const err = e as {stdout?: string, stderr?: string, code?: number}
		return {stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code ?? 1}
	}
}

async function run_deploy(skill_dir: string): Promise<Run_result> {
	const env = {...process.env}
	delete env.TARGET_DIRECTORY
	try {
		const result = await exec_file('node', [script, 'deploy', skill_dir], {env})
		return {stdout: result.stdout, stderr: result.stderr, code: 0}
	} catch (e: unknown) {
		const err = e as {stdout?: string, stderr?: string, code?: number}
		return {stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.code ?? 1}
	}
}

async function make_tmp_dir(): Promise<string> {
	return mkdtemp(join(tmpdir(), 'skill-shed-test-'))
}

// * Tests

// ** Init

const MY_SKILL_SOURCE_CONTENT = [
	'---',
	'name: my-skill',
	'description: >',
	'  What this skill does – generates files?  Executes shell scripts?',
	'  Sends HTTP requests?  When to use it – when the user asks or',
	'  mentions something?  Uploads a file of specific type?',
	'allowed-tools: Read, Bash(rg *)',
	'---',
	'',
	'<!-- NOTE: HTML comments are stripped on skill deployment, except',
	'     inside code blocks.  To disable stripping for a file, remove',
	'     `.source` from its name.  For example, to disable stripping',
	'     here, rename this file from SKILL.source.md to SKILL.md.     -->',
	'',
	'# My-skill skill',
].join('\n')

const MY_SKILL_CONTENT = [
	'---',
	'name: my-skill',
	'description: >',
	'  What this skill does – generates files?  Executes shell scripts?',
	'  Sends HTTP requests?  When to use it – when the user asks or',
	'  mentions something?  Uploads a file of specific type?',
	'allowed-tools: Read, Bash(rg *)',
	'---',
	'',
	'# My-skill skill',
].join('\n')

test('init: creates skill dir, .env, and SKILL.source.md by default', async () => {
	const parent = await make_tmp_dir()
	const skill_dir = join(parent, 'my-skill')
	const deploy_dir = await make_tmp_dir()

	const result = await run_init(skill_dir, deploy_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stderr.trim(), '')
	assert.strictEqual(result.stdout.trim(), [
		`Initialized ${skill_dir}`,
		`TARGET_DIRECTORY=${deploy_dir}`,
	].join('\n'))
	assert.strictEqual(
		(await readFile(join(skill_dir, '.env'), 'utf8')).trim(),
		`TARGET_DIRECTORY=${deploy_dir}`,
	)
	assert.strictEqual(
		(await readFile(join(skill_dir, 'SKILL.source.md'), 'utf8')).trim(),
		MY_SKILL_SOURCE_CONTENT,
	)
	const files = await readdir(skill_dir)
	assert.deepStrictEqual(files.sort(), ['.env', 'SKILL.source.md'])
})

test('init: --no-comments creates SKILL.md instead', async () => {
	const parent = await make_tmp_dir()
	const skill_dir = join(parent, 'my-skill')
	const deploy_dir = await make_tmp_dir()

	const result = await run_init(skill_dir, deploy_dir, ['--no-comments'])

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stderr.trim(), '')
	assert.strictEqual(result.stdout.trim(), [
		`Initialized ${skill_dir}`,
		`TARGET_DIRECTORY=${deploy_dir}`,
	].join('\n'))
	assert.strictEqual(
		(await readFile(join(skill_dir, '.env'), 'utf8')).trim(),
		`TARGET_DIRECTORY=${deploy_dir}`,
	)
	assert.strictEqual(
		(await readFile(join(skill_dir, 'SKILL.md'), 'utf8')).trim(),
		MY_SKILL_CONTENT,
	)
	const files = await readdir(skill_dir)
	assert.deepStrictEqual(files.sort(), ['.env', 'SKILL.md'])
})

test('init: --comments creates SKILL.source.md', async () => {
	const parent = await make_tmp_dir()
	const skill_dir = join(parent, 'my-skill')
	const deploy_dir = await make_tmp_dir()

	const result = await run_init(skill_dir, deploy_dir, ['--comments'])

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stderr.trim(), '')
	assert.strictEqual(result.stdout.trim(), [
		`Initialized ${skill_dir}`,
		`TARGET_DIRECTORY=${deploy_dir}`,
	].join('\n'))
	assert.strictEqual(
		(await readFile(join(skill_dir, '.env'), 'utf8')).trim(),
		`TARGET_DIRECTORY=${deploy_dir}`,
	)
	assert.strictEqual(
		(await readFile(join(skill_dir, 'SKILL.source.md'), 'utf8')).trim(),
		MY_SKILL_SOURCE_CONTENT,
	)
	const files = await readdir(skill_dir)
	assert.deepStrictEqual(files.sort(), ['.env', 'SKILL.source.md'])
})

test('init: --no-comments aborts when SKILL.source.md is present', async () => {
	const skill_dir = await make_tmp_dir()
	const deploy_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.source.md'), '# Existing\n')

	const result = await run_init(skill_dir, deploy_dir, ['--no-comments'])

	assert.strictEqual(result.code, 1)
	assert.strictEqual(result.stdout.trim(), '')
	assert.strictEqual(result.stderr.trim(), 'Error: cannot initialize SKILL.md when SKILL.source.md is present')
	assert.deepStrictEqual((await readdir(skill_dir)).sort(), ['SKILL.source.md'])
})

test('init: --comments aborts when SKILL.md is present', async () => {
	const skill_dir = await make_tmp_dir()
	const deploy_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# Existing\n')

	const result = await run_init(skill_dir, deploy_dir, ['--comments'])

	assert.strictEqual(result.code, 1)
	assert.strictEqual(result.stdout.trim(), '')
	assert.strictEqual(result.stderr.trim(), 'Error: cannot initialize SKILL.source.md when SKILL.md is present')
	assert.deepStrictEqual((await readdir(skill_dir)).sort(), ['SKILL.md'])
})

test('init: aborts when both SKILL.md and SKILL.source.md are present', async () => {
	const skill_dir = await make_tmp_dir()
	const deploy_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# A\n')
	await writeFile(join(skill_dir, 'SKILL.source.md'), '# B\n')

	const result = await run_init(skill_dir, deploy_dir)

	assert.strictEqual(result.code, 1)
	assert.strictEqual(result.stdout.trim(), '')
	assert.strictEqual(result.stderr.trim(), `Error: conflicting files in ${skill_dir}: SKILL.md, SKILL.source.md`)
	assert.deepStrictEqual((await readdir(skill_dir)).sort(), ['SKILL.md', 'SKILL.source.md'])
})

test('init: aborts when any two files share a deploy target', async () => {
	const skill_dir = await make_tmp_dir()
	const deploy_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'reference.md'), '# A\n')
	await writeFile(join(skill_dir, 'reference.source.md'), '# B\n')

	const result = await run_init(skill_dir, deploy_dir)

	assert.strictEqual(result.code, 1)
	assert.strictEqual(result.stdout.trim(), '')
	assert.strictEqual(result.stderr.trim(), `Error: conflicting files in ${skill_dir}: reference.md, reference.source.md`)
	assert.deepStrictEqual((await readdir(skill_dir)).sort(), ['reference.md', 'reference.source.md'])
})

test('init: creates .env in existing dir', async () => {
	const skill_dir = await make_tmp_dir()
	const deploy_dir = await make_tmp_dir()
	const skill_md_content = '# My skill\n'
	await writeFile(join(skill_dir, 'SKILL.md'), skill_md_content)

	const result = await run_init(skill_dir, deploy_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stderr.trim(), '')
	assert.strictEqual(result.stdout.trim(), [
		'SKILL.md already exists',
		`Initialized ${skill_dir}`,
		`TARGET_DIRECTORY=${deploy_dir}`,
	].join('\n'))
	assert.strictEqual(
		(await readFile(join(skill_dir, '.env'), 'utf8')).trim(),
		`TARGET_DIRECTORY=${deploy_dir}`,
	)
	assert.strictEqual((await readFile(join(skill_dir, 'SKILL.md'), 'utf8')).trim(), skill_md_content.trim())
	const files = await readdir(skill_dir)
	assert.deepStrictEqual(files.sort(), ['.env', 'SKILL.md'])
})

test('init: default creates .env when SKILL.source.md already exists', async () => {
	const skill_dir = await make_tmp_dir()
	const deploy_dir = await make_tmp_dir()
	const existing_content = '# Existing source\n'
	await writeFile(join(skill_dir, 'SKILL.source.md'), existing_content)

	const result = await run_init(skill_dir, deploy_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stderr.trim(), '')
	assert.strictEqual(result.stdout.trim(), [
		'SKILL.source.md already exists',
		`Initialized ${skill_dir}`,
		`TARGET_DIRECTORY=${deploy_dir}`,
	].join('\n'))
	assert.strictEqual(
		(await readFile(join(skill_dir, '.env'), 'utf8')).trim(),
		`TARGET_DIRECTORY=${deploy_dir}`,
	)
	assert.strictEqual((await readFile(join(skill_dir, 'SKILL.source.md'), 'utf8')).trim(), existing_content.trim())
	assert.deepStrictEqual((await readdir(skill_dir)).sort(), ['.env', 'SKILL.source.md'])
})

test('init: --no-comments creates .env when SKILL.md already exists', async () => {
	const skill_dir = await make_tmp_dir()
	const deploy_dir = await make_tmp_dir()
	const existing_content = '# Existing skill\n'
	await writeFile(join(skill_dir, 'SKILL.md'), existing_content)

	const result = await run_init(skill_dir, deploy_dir, ['--no-comments'])

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stderr.trim(), '')
	assert.strictEqual(result.stdout.trim(), [
		'SKILL.md already exists',
		`Initialized ${skill_dir}`,
		`TARGET_DIRECTORY=${deploy_dir}`,
	].join('\n'))
	assert.strictEqual(
		(await readFile(join(skill_dir, '.env'), 'utf8')).trim(),
		`TARGET_DIRECTORY=${deploy_dir}`,
	)
	assert.strictEqual((await readFile(join(skill_dir, 'SKILL.md'), 'utf8')).trim(), existing_content.trim())
	assert.deepStrictEqual((await readdir(skill_dir)).sort(), ['.env', 'SKILL.md'])
})

test('init: aborts if .env already exists', async () => {
	const skill_dir = await make_tmp_dir()
	const original_env = 'TARGET_DIRECTORY=/some/path\n'
	await writeFile(join(skill_dir, '.env'), original_env)

	const result = await run_init(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.strictEqual(result.stdout.trim(), '')
	assert.strictEqual(result.stderr.trim(), `Error: .env already exists in ${skill_dir}`)
	assert.strictEqual((await readFile(join(skill_dir, '.env'), 'utf8')).trim(), original_env.trim())
	const files = await readdir(skill_dir)
	assert.deepStrictEqual(files.sort(), ['.env'])
})

test('init: does not create SKILL.md if it already exists', async () => {
	const skill_dir = await make_tmp_dir()
	const deploy_dir = await make_tmp_dir()
	const original = '# Existing skill\n'
	await writeFile(join(skill_dir, 'SKILL.md'), original)

	const result = await run_init(skill_dir, deploy_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stderr.trim(), '')
	assert.strictEqual(result.stdout.trim(), [
		'SKILL.md already exists',
		`Initialized ${skill_dir}`,
		`TARGET_DIRECTORY=${deploy_dir}`,
	].join('\n'))
	assert.strictEqual(
		(await readFile(join(skill_dir, '.env'), 'utf8')).trim(),
		`TARGET_DIRECTORY=${deploy_dir}`,
	)
	assert.strictEqual((await readFile(join(skill_dir, 'SKILL.md'), 'utf8')).trim(), original.trim())
	const files = await readdir(skill_dir)
	assert.deepStrictEqual(files.sort(), ['.env', 'SKILL.md'])
})

test('init: default deploy dir is ~/.claude/skills/<skill-name>', async () => {
	const parent = await make_tmp_dir()
	const skill_dir = join(parent, 'my-skill')

	const result = await run_init(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stderr.trim(), '')
	const expected_deploy_dir = resolve(homedir(), '.claude', 'skills', basename(skill_dir))
	assert.strictEqual(result.stdout.trim(), [
		`Initialized ${skill_dir}`,
		`TARGET_DIRECTORY=${expected_deploy_dir}`,
	].join('\n'))
	assert.strictEqual(
		(await readFile(join(skill_dir, '.env'), 'utf8')).trim(),
		`TARGET_DIRECTORY=${expected_deploy_dir}`,
	)
	assert.strictEqual(
		(await readFile(join(skill_dir, 'SKILL.source.md'), 'utf8')).trim(),
		MY_SKILL_SOURCE_CONTENT,
	)
	const files = await readdir(skill_dir)
	assert.deepStrictEqual(files.sort(), ['.env', 'SKILL.source.md'])
})

// ** Deploy

test('deploy: missing .env', async () => {
	const skill_dir = await make_tmp_dir()

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /no \.env file found/)
})

test('deploy: missing TARGET_DIRECTORY in .env', async () => {
	const skill_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, '.env'), '# no TARGET_DIRECTORY here\n')

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /TARGET_DIRECTORY not set/)
})

test('deploy: missing SKILL.md and SKILL.source.md', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /no SKILL\.md or SKILL\.source\.md found/)
})

test('deploy: both SKILL.md and SKILL.source.md aborts', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# skill\n')
	await writeFile(join(skill_dir, 'SKILL.source.md'), '# skill\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 1)
	assert.match(result.stderr, /both SKILL\.source\.md and SKILL\.md found/)
})

test('deploy: SKILL.source.md is stripped and deployed as SKILL.md', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(
		join(skill_dir, 'SKILL.source.md'),
		'# My skill\n\n<!-- a comment -->\n\nSome text.\n',
	)
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const deployed = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed, '# My skill\n\nSome text.\n')
})

test('deploy: target directory is created if missing', async () => {
	const skill_dir = await make_tmp_dir()
	const content = '# Test skill\n'
	await writeFile(join(skill_dir, 'SKILL.md'), content)
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${skill_dir}/nonexistent\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const deployed = await readFile(join(skill_dir, 'nonexistent', 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed, content)
})

test('deploy: successful deploy', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	const content = '# My skill\n'
	await writeFile(join(skill_dir, 'SKILL.md'), content)
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	const result = await run_deploy(skill_dir)

	assert.strictEqual(result.code, 0)
	const deployed = await readFile(join(target_dir, 'SKILL.md'), 'utf8')
	assert.strictEqual(deployed, content)
})

test('deploy: mtime guard aborts when target is newer', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# My skill\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	// First deploy
	const first = await run_deploy(skill_dir)

	assert.strictEqual(first.code, 0)

	// Make target appear newer than source
	const future = new Date(Date.now() + 60_000)
	await utimes(join(target_dir, 'SKILL.md'), future, future)

	// Second deploy
	const second = await run_deploy(skill_dir)

	assert.strictEqual(second.code, 1)
	assert.match(second.stderr, /is newer than source/)
})

test('deploy: mtime guard allows deploy when source is newer', async () => {
	const skill_dir = await make_tmp_dir()
	const target_dir = await make_tmp_dir()
	await writeFile(join(skill_dir, 'SKILL.md'), '# My skill\n')
	await writeFile(join(skill_dir, '.env'), `TARGET_DIRECTORY=${target_dir}\n`)

	// First deploy
	const first = await run_deploy(skill_dir)

	assert.strictEqual(first.code, 0)

	// Make source appear newer than target
	const future = new Date(Date.now() + 60_000)
	await utimes(join(skill_dir, 'SKILL.md'), future, future)

	// Second deploy
	const second = await run_deploy(skill_dir)

	assert.strictEqual(second.code, 0)
})

// ** strip_html_comments

test('strip_html_comments: empty input unchanged', () => {
	assert.strictEqual(strip_html_comments(''), '')
})

test('strip_html_comments: no comments → unchanged', () => {
	const input = [
		'# Heading',
		'',
		'Some text.',
		'',
	].join('\n')
	assert.strictEqual(strip_html_comments(input), input)
})

test('strip_html_comments: inline comment removed', () => {
	assert.strictEqual(
		strip_html_comments([
			'before <!-- note --> after',
			'',
		].join('\n')),
		[
			'before  after',
			'',
		].join('\n'),
	)
})

test('strip_html_comments: full-line comment dropped', () => {
	assert.strictEqual(
		strip_html_comments([
			'line one',
			'<!-- comment -->',
			'line two',
			'',
		].join('\n')),
		[
			'line one',
			'line two',
			'',
		].join('\n'),
	)
})

test('strip_html_comments: comment between blank lines collapses to one blank line', () => {
	assert.strictEqual(
		strip_html_comments([
			'line one',
			'',
			'<!-- comment -->',
			'',
			'line two',
			'',
		].join('\n')),
		[
			'line one',
			'',
			'line two',
			'',
		].join('\n'),
	)
})

test('strip_html_comments: multiple blank lines before comment are preserved', () => {
	assert.strictEqual(
		strip_html_comments([
			'line one',
			'',
			'',
			'<!-- comment -->',
			'',
			'line two',
			'',
		].join('\n')),
		[
			'line one',
			'',
			'',
			'line two',
			'',
		].join('\n'),
	)
})

test('strip_html_comments: multiline comment dropped', () => {
	assert.strictEqual(
		strip_html_comments([
			'before',
			'<!-- start',
			'middle',
			'end -->',
			'after',
			'',
		].join('\n')),
		[
			'before',
			'after',
			'',
		].join('\n'),
	)
})

test('strip_html_comments: comment inside fenced code block preserved', () => {
	const input = [
		'```',
		'<!-- not stripped -->',
		'```',
		'',
	].join('\n')
	assert.strictEqual(strip_html_comments(input), input)
})

test('strip_html_comments: comment inside tilde-fenced block preserved', () => {
	const input = [
		'~~~',
		'<!-- not stripped -->',
		'~~~',
		'',
	].join('\n')
	assert.strictEqual(strip_html_comments(input), input)
})

test('strip_html_comments: multiline comment inside fenced block preserved', () => {
	const input = [
		'```',
		'<!-- not',
		'stripped -->',
		'```',
		'',
	].join('\n')
	assert.strictEqual(strip_html_comments(input), input)
})

test('strip_html_comments: multiple comments on one line', () => {
	assert.strictEqual(
		strip_html_comments([
			'a <!-- x --> b <!-- y --> c',
			'',
		].join('\n')),
		[
			'a  b  c',
			'',
		].join('\n'),
	)
})

test('strip_html_comments: comment starts mid-line, spans multiple lines, text follows closing', () => {
	assert.strictEqual(
		strip_html_comments([
			'a <!-- x',
			'y',
			'z --> b',
			'c',
			'',
		].join('\n')),
		[
			'a ',
			' b',
			'c',
			'',
		].join('\n'),
	)
})

// ** target_filename

test('target_filename: .md unchanged', () => {
	assert.strictEqual(target_filename('SKILL.md'), 'SKILL.md')
})

test('target_filename: .source.md → .md', () => {
	assert.strictEqual(target_filename('SKILL.source.md'), 'SKILL.md')
})

test('target_filename: non-md extension unchanged', () => {
	assert.strictEqual(target_filename('template.html'), 'template.html')
})

test('target_filename: no extension unchanged', () => {
	assert.strictEqual(target_filename('LICENSE'), 'LICENSE')
})

// * build_manifest_from_dir

test('build_manifest_from_dir: returns files with their contents', async () => {
	const dir = await make_tmp_dir()
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await writeFile(join(dir, 'extra.txt'), 'world')

	const manifest = await build_manifest_from_dir(dir)

	assert.deepStrictEqual([...manifest.keys()].sort(), ['SKILL.md', 'extra.txt'])
	assert.strictEqual(manifest.get('SKILL.md')!.toString(), 'hello')
	assert.strictEqual(manifest.get('extra.txt')!.toString(), 'world')
})

test('build_manifest_from_dir: excludes dotfiles', async () => {
	const dir = await make_tmp_dir()
	await writeFile(join(dir, 'SKILL.md'), 'content')
	await writeFile(join(dir, '.env'), 'SECRET=1')
	await writeFile(join(dir, '.gitignore'), '*.log')

	const manifest = await build_manifest_from_dir(dir)

	assert.deepStrictEqual([...manifest.keys()], ['SKILL.md'])
})

test('build_manifest_from_dir: empty directory returns empty map', async () => {
	const dir = await make_tmp_dir()

	const manifest = await build_manifest_from_dir(dir)

	assert.strictEqual(manifest.size, 0)
})

test('build_manifest_from_dir: only dotfiles returns empty map', async () => {
	const dir = await make_tmp_dir()
	await writeFile(join(dir, '.env'), 'X=1')

	const manifest = await build_manifest_from_dir(dir)

	assert.strictEqual(manifest.size, 0)
})

test('build_manifest_from_dir: keys are sorted', async () => {
	const dir = await make_tmp_dir()
	await writeFile(join(dir, 'zebra.txt'), '')
	await writeFile(join(dir, 'alpha.txt'), '')
	await writeFile(join(dir, 'middle.txt'), '')

	const manifest = await build_manifest_from_dir(dir)

	assert.deepStrictEqual([...manifest.keys()], ['alpha.txt', 'middle.txt', 'zebra.txt'])
})

test('build_manifest_from_dir: .md files stored as strings', async () => {
	const dir = await make_tmp_dir()
	await writeFile(join(dir, 'SKILL.md'), 'hello')
	await writeFile(join(dir, 'SKILL.source.md'), 'world')

	const manifest = await build_manifest_from_dir(dir)

	assert.strictEqual(typeof manifest.get('SKILL.md'), 'string')
	assert.strictEqual(typeof manifest.get('SKILL.source.md'), 'string')
})

test('build_manifest_from_dir: non-.md files stored as Buffers', async () => {
	const dir = await make_tmp_dir()
	await writeFile(join(dir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
	await writeFile(join(dir, 'notes.txt'), 'text')

	const manifest = await build_manifest_from_dir(dir)

	assert.ok(manifest.get('image.png') instanceof Buffer)
	assert.ok(manifest.get('notes.txt') instanceof Buffer)
})
