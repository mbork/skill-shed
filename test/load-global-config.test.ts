// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'
import {homedir} from 'node:os'
import {load_global_config} from '../src/global-config.ts'
import {make_tmp_dir} from './helpers.ts'

// * load_global_config

test('load_global_config: missing config file returns defaults', async () => {
	const nonexistent = join(await make_tmp_dir(), 'nonexistent.json')
	process.env.SKILL_SHED_CONFIG = nonexistent
	try {
		const config = await load_global_config()
		assert.strictEqual(config.default_target_directory, resolve(homedir(), '.agents', 'skills'))
	} finally {
		delete process.env.SKILL_SHED_CONFIG
	}
})

test('load_global_config: reads DEFAULT_TARGET_DIRECTORY from config file', async () => {
	const config_file = join(await make_tmp_dir(), 'skill-shed.env')
	await writeFile(config_file, 'DEFAULT_TARGET_DIRECTORY=/some/path\n')
	process.env.SKILL_SHED_CONFIG = config_file
	try {
		const config = await load_global_config()
		assert.strictEqual(config.default_target_directory, '/some/path')
	} finally {
		delete process.env.SKILL_SHED_CONFIG
	}
})

test('load_global_config: expands leading ~ in DEFAULT_TARGET_DIRECTORY', async () => {
	const config_file = join(await make_tmp_dir(), 'skill-shed.env')
	await writeFile(config_file, 'DEFAULT_TARGET_DIRECTORY=~/custom/path\n')
	process.env.SKILL_SHED_CONFIG = config_file
	try {
		const config = await load_global_config()
		assert.strictEqual(config.default_target_directory, resolve(homedir(), 'custom/path'))
	} finally {
		delete process.env.SKILL_SHED_CONFIG
	}
})

test('load_global_config: ignores unknown keys', async () => {
	const config_file = join(await make_tmp_dir(), 'skill-shed.env')
	await writeFile(config_file, 'DEFAULT_TARGET_DIRECTORY=/p\nUNKNOWN_KEY=42\n')
	process.env.SKILL_SHED_CONFIG = config_file
	try {
		const config = await load_global_config()
		assert.strictEqual(config.default_target_directory, '/p')
		assert.ok(!('UNKNOWN_KEY' in config))
	} finally {
		delete process.env.SKILL_SHED_CONFIG
	}
})

// ** Global config

test('load_global_config: empty DEFAULT_TARGET_DIRECTORY falls back to default', async () => {
	const config_file = join(await make_tmp_dir(), 'skill-shed.env')
	await writeFile(config_file, 'DEFAULT_TARGET_DIRECTORY=\n')
	process.env.SKILL_SHED_CONFIG = config_file
	try {
		const config = await load_global_config()
		assert.strictEqual(config.default_target_directory, resolve(homedir(), '.agents', 'skills'))
	} finally {
		delete process.env.SKILL_SHED_CONFIG
	}
})
