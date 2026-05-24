// * Imports
import {execFile as execFile_cb} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {parseEnv, promisify} from 'node:util'

const execFile = promisify(execFile_cb)

// * read_env_file
// Reads and parses a dotenv-format file.  Returns the parsed map, or null when the file
// is absent (ENOENT).  Other read errors propagate.
export async function read_env_file(path: string): Promise<NodeJS.Dict<string> | null> {
	try {
		return parseEnv(await readFile(path, 'utf8'))
	} catch (e: unknown) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
			return null
		}
		throw e
	}
}

// * detect_git
export async function detect_git(dir: string): Promise<'no-git' | 'no-repo' | 'ok'> {
	try {
		await execFile('git', ['rev-parse', '--is-inside-work-tree'], {cwd: dir})
		return 'ok'
	} catch (e: unknown) {
		const err = e as NodeJS.ErrnoException & {stderr?: string}
		if (err.code === 'ENOENT') {
			return 'no-git'
		}
		if (err.stderr?.includes('not a git repository')) {
			return 'no-repo'
		}
		throw e
	}
}

// * expand_tilde
export function expand_tilde(p: string): string {
	if (p === '~' || p.startsWith('~/')) {
		return homedir() + p.slice(1)
	}
	return p
}
