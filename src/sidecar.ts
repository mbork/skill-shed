// The sidecar (.skill-shed-manifest.json in the target directory) records SHA-256 hashes of
// deployed files so the next deploy can detect direct edits or externally created files.

// * Imports
import {createHash} from 'node:crypto'
import {readFile, stat, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import type {Manifest} from './manifest.ts'

// * Constants
export const SIDECAR_FILENAME = '.skill-shed-manifest.json'

// * Types
export interface Sidecar {
	version: number
	files: Record<string, string>
}

// * hash_content
export function hash_content(content: string | Buffer): string {
	const hash = createHash('sha256')
	hash.update(typeof content === 'string' ? Buffer.from(content, 'utf8') : content)
	return hash.digest('hex')
}

// * read_sidecar
export async function read_sidecar(target_dir: string): Promise<Sidecar> {
	const sidecar_path = resolve(target_dir, SIDECAR_FILENAME)
	try {
		const raw = await readFile(sidecar_path, 'utf8')
		return JSON.parse(raw) as Sidecar
	} catch (e: unknown) {
		const err = e as NodeJS.ErrnoException
		if (err.code === 'ENOENT') {
			return {version: 1, files: {}}
		}
		throw e
	}
}

// * write_sidecar
export async function write_sidecar(target_dir: string, sidecar: Sidecar): Promise<void> {
	const sidecar_path = resolve(target_dir, SIDECAR_FILENAME)
	await writeFile(sidecar_path, JSON.stringify(sidecar, null, 2) + '\n')
}

// * collect_overwrite_violations
export async function collect_overwrite_violations(
	manifest: Manifest,
	target_dir: string,
	sidecar: Sidecar,
): Promise<string[]> {
	const violations: string[] = []
	for (const entry of manifest) {
		const target_path = resolve(target_dir, entry.target_name)
		let is_target_present = false
		try {
			await stat(target_path)
			is_target_present = true
		} catch (e: unknown) {
			const err = e as NodeJS.ErrnoException
			if (err.code !== 'ENOENT') {
				throw e
			}
		}
		if (!is_target_present) {
			continue
		}
		const stored_hash = sidecar.files[entry.target_name]
		if (stored_hash === undefined) {
			violations.push(
				`${entry.target_name}: exists in target but was not deployed by skill-shed;`
				+ ` use --force to overwrite`,
			)
		} else {
			const current_content = await readFile(target_path)
			const current_hash = hash_content(current_content)
			if (current_hash !== stored_hash) {
				violations.push(
					`${entry.target_name}: target was modified after last deploy;`
					+ ` use --force to overwrite`,
				)
			}
		}
	}
	return violations
}

// * Stale files

// * find_stale_names
// Returns sidecar-owned file names absent from the manifest — stale files to delete.
export function find_stale_names(manifest: Manifest, sidecar: Sidecar): string[] {
	const manifest_targets = new Set(manifest.map(e => e.target_name))
	return Object.keys(sidecar.files).filter(name => !manifest_targets.has(name))
}

// * collect_stale_violations
// Returns violation messages for stale files that were modified after last deploy.
export async function collect_stale_violations(
	stale_names: string[],
	target_dir: string,
	sidecar: Sidecar,
): Promise<string[]> {
	const violations: string[] = []
	for (const name of stale_names) {
		const target_path = resolve(target_dir, name)
		let current_content: Buffer
		try {
			current_content = await readFile(target_path)
		} catch (e: unknown) {
			const err = e as NodeJS.ErrnoException
			if (err.code === 'ENOENT') {
				continue
			}
			throw e
		}
		const current_hash = hash_content(current_content)
		if (current_hash !== sidecar.files[name]) {
			violations.push(
				`${name}: stale file was modified after last deploy;`
				+ ` use --force to delete`,
			)
		}
	}
	return violations
}
