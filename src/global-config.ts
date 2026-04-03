// * Imports
import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {homedir} from 'node:os'
import {parseEnv} from 'node:util'

// * Types
export interface Global_config {
	default_target_directory: string
}

// * Constants
const DEFAULT_CONFIG: Global_config = {
	default_target_directory: resolve(homedir(), '.agents', 'skills'),
}

// * load_global_config
export async function load_global_config(): Promise<Global_config> {
	const config_path = process.env.SKILL_SHED_CONFIG
		?? resolve(homedir(), '.skill-shed.env')
	try {
		const raw = await readFile(config_path, 'utf8')
		const parsed = parseEnv(raw)
		return {
			default_target_directory: parsed.DEFAULT_TARGET_DIRECTORY
				|| DEFAULT_CONFIG.default_target_directory,
		}
	} catch (e: unknown) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
			return DEFAULT_CONFIG
		}
		throw e
	}
}
