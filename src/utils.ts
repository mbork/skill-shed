// * Imports
import {execFile as execFile_cb} from 'node:child_process'
import {homedir} from 'node:os'
import {promisify} from 'node:util'

const execFile = promisify(execFile_cb)

// * detect_git
async function detect_git(dir: string): Promise<'no-git' | 'no-repo' | 'ok'> {
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

// * ensure_git_or_abort
export async function ensure_git_or_abort(dir: string): Promise<void> {
	const status = await detect_git(dir)
	if (status === 'no-git') {
		console.error(
			'Error: git not found; install git and run `git init`, or set MANIFEST_COMMAND in .env',
		)
		process.exit(1)
	}
	if (status === 'no-repo') {
		console.error('Error: not a git repository; run `git init` or set MANIFEST_COMMAND in .env')
		process.exit(1)
	}
}

// * expand_tilde
export function expand_tilde(p: string): string {
	if (p === '~' || p.startsWith('~/')) {
		return homedir() + p.slice(1)
	}
	return p
}
