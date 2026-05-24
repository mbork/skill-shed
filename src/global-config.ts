// * Imports
import {resolve} from 'node:path'
import {homedir} from 'node:os'
import {expand_tilde, read_env_file} from './utils.ts'

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
	const parsed = await read_env_file(config_path)
	if (parsed === null) {
		return DEFAULT_CONFIG
	}
	return {
		default_target_directory: expand_tilde(
			parsed.DEFAULT_TARGET_DIRECTORY || DEFAULT_CONFIG.default_target_directory,
		),
	}
}
