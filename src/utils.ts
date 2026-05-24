// * Imports
import {execFile as execFile_cb} from 'node:child_process'
import {homedir} from 'node:os'
import {promisify} from 'node:util'

const execFile = promisify(execFile_cb)

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
