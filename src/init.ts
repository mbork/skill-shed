// * Imports
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises'
import {resolve, basename} from 'node:path'
import {strip_html_comments} from './strip-html-comments.ts'
import {find_target_conflicts} from './manifest.ts'
import {load_global_config} from './global-config.ts'

// * init
export async function init(skill_dir: string, deploy_dir_arg?: string, comments_mode: boolean | null = null): Promise<void> {
	const skill_name = basename(skill_dir)
	const config = await load_global_config()
	const deploy_dir = deploy_dir_arg
		? resolve(deploy_dir_arg)
		: resolve(config.default_target_directory, skill_name)

	await mkdir(skill_dir, {recursive: true})

	const existing = new Set((await readdir(skill_dir)).sort())

	const conflicts = find_target_conflicts([...existing])
	if (conflicts.length > 0) {
		const conflict_list = conflicts.map(group => group.join(', ')).join('; ')
		console.error(`Error: conflicting files in ${skill_dir}: ${conflict_list}`)
		process.exit(1)
	}

	if (existing.has('.env')) {
		console.error(`Error: .env already exists in ${skill_dir}`)
		process.exit(1)
	}

	const is_skill_md_present = existing.has('SKILL.md')
	const is_skill_source_md_present = existing.has('SKILL.source.md')
	const is_skill_file_present = is_skill_md_present || is_skill_source_md_present

	if (is_skill_source_md_present) {
		if (comments_mode === false) {
			console.error(`Error: cannot initialize SKILL.md when SKILL.source.md is present`)
			process.exit(1)
		}
		console.log(`SKILL.source.md already exists`)
	} else if (is_skill_md_present) {
		if (comments_mode === true) {
			console.error(`Error: cannot initialize SKILL.source.md when SKILL.md is present`)
			process.exit(1)
		}
		console.log(`SKILL.md already exists`)
	}

	await writeFile(resolve(skill_dir, '.env'), `TARGET_DIRECTORY=${deploy_dir}
# MANIFEST_COMMAND: command to list skill files, one per line (relative paths).
# Set this if git is not available or you want a non-git workflow.
# Examples:
#   GNU find (Linux):   MANIFEST_COMMAND=find . -type f -not -path '*/.*'
#   BSD find (macOS):   MANIFEST_COMMAND=find . -type f ! -path '*/.*'
#   Windows (Git Bash): use the GNU find example above
`)

	if (!is_skill_file_present) {
		const new_skill_path = resolve(
			skill_dir,
			(comments_mode ?? true) ? 'SKILL.source.md' : 'SKILL.md',
		)
		const template_path = resolve(import.meta.dirname, '..', 'assets', 'SKILL.template.md')
		const template = await readFile(template_path, 'utf8')
		const substituted = template
			.replace('{{name}}', skill_name)
			.replace('{{Name}}', skill_name.charAt(0).toUpperCase() + skill_name.slice(1))
		const should_strip_comments = !(comments_mode ?? true)
		const skill_content = should_strip_comments ? strip_html_comments(substituted) : substituted
		await writeFile(new_skill_path, skill_content)
	}

	console.log(`Initialized ${skill_dir}`)
	console.log(`TARGET_DIRECTORY=${deploy_dir}`)
}
