// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {writeFile, readFile, readdir} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join, resolve, basename} from 'node:path'
import {run_init, make_tmp_dir, strip_env_comments, setup_git, exec_file} from './helpers.ts'

// * Init

const MY_SKILL_SOURCE_CONTENT = [
	'---',
	'name: my-skill',
	'description: >',
	'  What this skill does – generates files?  Executes shell scripts?',
	'  Sends HTTP requests?  When to use it – when the user asks or',
	'  mentions something?  Uploads a file of specific type?  Fill the',
	'  details in here.',
	'allowed-tools: Read, Bash(rg *)',
	'---',
	'',
	'<!-- NOTE: HTML comments are stripped on skill deployment, except',
	'     inside code blocks.  To disable stripping for a file, remove',
	'     `.source` from its name.  For example, to disable stripping',
	'     here, rename this file from `SKILL.source.md` to `SKILL.md`. -->',
	'',
	'# My-skill skill',
].join('\n')

const MY_SKILL_CONTENT = [
	'---',
	'name: my-skill',
	'description: >',
	'  What this skill does – generates files?  Executes shell scripts?',
	'  Sends HTTP requests?  When to use it – when the user asks or',
	'  mentions something?  Uploads a file of specific type?  Fill the',
	'  details in here.',
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
		`.env created in ${skill_dir}, don't forget to add it to .gitignore if you initialize a Git repo later`,
	].join('\n'))
	assert.strictEqual(
		strip_env_comments(await readFile(join(skill_dir, '.env'), 'utf8')),
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
		`.env created in ${skill_dir}, don't forget to add it to .gitignore if you initialize a Git repo later`,
	].join('\n'))
	assert.strictEqual(
		strip_env_comments(await readFile(join(skill_dir, '.env'), 'utf8')),
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
		`.env created in ${skill_dir}, don't forget to add it to .gitignore if you initialize a Git repo later`,
	].join('\n'))
	assert.strictEqual(
		strip_env_comments(await readFile(join(skill_dir, '.env'), 'utf8')),
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
		`.env created in ${skill_dir}, don't forget to add it to .gitignore if you initialize a Git repo later`,
	].join('\n'))
	assert.strictEqual(
		strip_env_comments(await readFile(join(skill_dir, '.env'), 'utf8')),
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
		`.env created in ${skill_dir}, don't forget to add it to .gitignore if you initialize a Git repo later`,
	].join('\n'))
	assert.strictEqual(
		strip_env_comments(await readFile(join(skill_dir, '.env'), 'utf8')),
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
		`.env created in ${skill_dir}, don't forget to add it to .gitignore if you initialize a Git repo later`,
	].join('\n'))
	assert.strictEqual(
		strip_env_comments(await readFile(join(skill_dir, '.env'), 'utf8')),
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
	assert.strictEqual(strip_env_comments(await readFile(join(skill_dir, '.env'), 'utf8')), original_env.trim())
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
		`.env created in ${skill_dir}, don't forget to add it to .gitignore if you initialize a Git repo later`,
	].join('\n'))
	assert.strictEqual(
		strip_env_comments(await readFile(join(skill_dir, '.env'), 'utf8')),
		`TARGET_DIRECTORY=${deploy_dir}`,
	)
	assert.strictEqual((await readFile(join(skill_dir, 'SKILL.md'), 'utf8')).trim(), original.trim())
	const files = await readdir(skill_dir)
	assert.deepStrictEqual(files.sort(), ['.env', 'SKILL.md'])
})

test('init: default deploy dir is ~/.agents/skills/<skill-name>', async () => {
	const parent = await make_tmp_dir()
	const skill_dir = join(parent, 'my-skill')

	const result = await run_init(skill_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stderr.trim(), '')
	const expected_deploy_dir = resolve(homedir(), '.agents', 'skills', basename(skill_dir))
	assert.strictEqual(result.stdout.trim(), [
		`Initialized ${skill_dir}`,
		`TARGET_DIRECTORY=${expected_deploy_dir}`,
		`.env created in ${skill_dir}, don't forget to add it to .gitignore if you initialize a Git repo later`,
	].join('\n'))
	assert.strictEqual(
		strip_env_comments(await readFile(join(skill_dir, '.env'), 'utf8')),
		`TARGET_DIRECTORY=${expected_deploy_dir}`,
	)
	assert.strictEqual(
		(await readFile(join(skill_dir, 'SKILL.source.md'), 'utf8')).trim(),
		MY_SKILL_SOURCE_CONTENT,
	)
	const files = await readdir(skill_dir)
	assert.deepStrictEqual(files.sort(), ['.env', 'SKILL.source.md'])
})

test('init: falls back to ~/.agents/skills when global config is absent', async () => {
	const parent = await make_tmp_dir()
	const skill_dir = join(parent, 'my-skill')
	const nonexistent_config = join(await make_tmp_dir(), 'nonexistent.json')
	const env = {...process.env, SKILL_SHED_CONFIG: nonexistent_config}

	const result = await run_init(skill_dir, undefined, [], {env})

	assert.strictEqual(result.code, 0)
	const env_content = await readFile(join(skill_dir, '.env'), 'utf8')
	assert.strictEqual(strip_env_comments(env_content), `TARGET_DIRECTORY=${resolve(homedir(), '.agents', 'skills', 'my-skill')}`)
})

test('init: uses default_target_directory from global config when no deploy_dir given', async () => {
	const parent = await make_tmp_dir()
	const skill_dir = join(parent, 'my-skill')
	const base_dir = await make_tmp_dir()
	const config_file = join(await make_tmp_dir(), 'skill-shed.env')
	await writeFile(config_file, `DEFAULT_TARGET_DIRECTORY=${base_dir}\n`)
	const env = {...process.env, SKILL_SHED_CONFIG: config_file}

	const result = await run_init(skill_dir, undefined, [], {env})

	assert.strictEqual(result.code, 0)
	const env_content = await readFile(join(skill_dir, '.env'), 'utf8')
	assert.strictEqual(strip_env_comments(env_content), `TARGET_DIRECTORY=${join(base_dir, 'my-skill')}`)
})

test('init: explicit deploy_dir overrides global config', async () => {
	const parent = await make_tmp_dir()
	const skill_dir = join(parent, 'my-skill')
	const explicit_dir = await make_tmp_dir()
	const config_file = join(await make_tmp_dir(), 'skill-shed.env')
	await writeFile(config_file, 'DEFAULT_TARGET_DIRECTORY=/should/not/be/used\n')
	const env = {...process.env, SKILL_SHED_CONFIG: config_file}

	const result = await run_init(skill_dir, explicit_dir, [], {env})

	assert.strictEqual(result.code, 0)
	const env_content = await readFile(join(skill_dir, '.env'), 'utf8')
	assert.strictEqual(strip_env_comments(env_content), `TARGET_DIRECTORY=${explicit_dir}`)
})

test('init: .env message says "ignored by Git" when already ignored', async () => {
	const skill_dir = await make_tmp_dir()
	const deploy_dir = await make_tmp_dir()
	await setup_git(skill_dir)

	const result = await run_init(skill_dir, deploy_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), [
		`Initialized ${skill_dir}`,
		`TARGET_DIRECTORY=${deploy_dir}`,
		`.env created in ${skill_dir}, ignored by Git`,
	].join('\n'))
})

test('init: .gitignore hint when .env is not ignored in git repo', async () => {
	const skill_dir = await make_tmp_dir()
	const deploy_dir = await make_tmp_dir()
	await exec_file('git', ['init'], {cwd: skill_dir})

	const result = await run_init(skill_dir, deploy_dir)

	assert.strictEqual(result.code, 0)
	assert.strictEqual(result.stdout.trim(), [
		`Initialized ${skill_dir}`,
		`TARGET_DIRECTORY=${deploy_dir}`,
		`.env created in ${skill_dir}, add it to .gitignore`,
	].join('\n'))
})
