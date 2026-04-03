// * Imports
import {homedir} from 'node:os'

// * expand_tilde
export function expand_tilde(p: string): string {
	if (p === '~' || p.startsWith('~/')) {
		return homedir() + p.slice(1)
	}
	return p
}
