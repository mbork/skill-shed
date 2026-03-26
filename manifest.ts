// * Manifest
// Build a Map of filename -> content for all non-dotfiles in a directory.
// Files with a .md extension are stored as UTF-8 strings; all others as Buffers.

import {readdir, readFile} from 'node:fs/promises'
import {resolve} from 'node:path'

export type Manifest = Map<string, string | Buffer>

// ** build_manifest_from_dir
export async function build_manifest_from_dir(dir: string): Promise<Manifest> {
	const entries = (await readdir(dir)).sort()
	const manifest: Manifest = new Map()
	for (const entry of entries) {
		if (entry.startsWith('.')) {
			continue
		}
		const buffer = await readFile(resolve(dir, entry))
		manifest.set(entry, entry.endsWith('.md') ? buffer.toString('utf8') : buffer)
	}
	return manifest
}
