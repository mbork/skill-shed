// * Frontmatter extraction
// Parses the YAML frontmatter block at the start of a SKILL.md file.
// Delimiter rules: opening `---` at column 0, line 0 (trailing whitespace allowed);
// closing `---` or `...` at column 0 (trailing whitespace allowed).
// See: https://yaml.org/spec/1.2.2/#912-document-markers
//      https://jekyllrb.com/docs/front-matter/
//      https://pandoc.org/MANUAL.html#extension-yaml_metadata_block

import {parseDocument, isMap, isScalar} from 'yaml'
import {closestMatch} from 'leven'

// * Types

// kind: 'none'  — file does not start with ---; no frontmatter present
// kind: 'error' — frontmatter block found but malformed (unclosed or invalid YAML)
// kind: 'ok'    — frontmatter parsed successfully
export type FrontmatterResult
	= | {kind: 'none'}
		| {kind: 'error', message: string}
		| {
			kind: 'ok'
			fields: Record<string, unknown>
			body: string
			field_lines: Map<string, number> // key → 1-based file line number
		}

export interface FieldIssue {line: number, severity: 'error' | 'warning', message: string}

// * extract_frontmatter
export function extract_frontmatter(content: string): FrontmatterResult {
	const lines = content.split('\n')

	if (!lines[0]?.match(/^---\s*$/)) {
		return {kind: 'none'}
	}

	let close_line = -1
	for (let i = 1; i < lines.length; i++) {
		if (/^(---|\.\.\.)\s*$/.test(lines[i])) {
			close_line = i
			break
		}
	}

	if (close_line === -1) {
		return {kind: 'error', message: 'unclosed frontmatter (no closing --- or ...)'}
	}

	const yaml_content = lines.slice(1, close_line).join('\n')
	const body = lines.slice(close_line + 1).join('\n')
	const doc = parseDocument(yaml_content)

	if (doc.errors.length > 0) {
		const messages = doc.errors.map(e => e.message).join('; ')
		return {kind: 'error', message: `invalid YAML in frontmatter: ${messages}`}
	}

	if (doc.contents !== null && !isMap(doc.contents)) {
		return {kind: 'error', message: 'frontmatter must be a YAML mapping'}
	}

	const fields = (doc.toJSON() ?? {}) as Record<string, unknown>

	// Map each top-level key to its 1-based file line number.
	// yaml offsets are relative to yaml_content, which starts on file line 1 (0-based)
	// (line 0 is the opening ---).  Conversion: file_line_1based = yaml_line_0based + 2.
	const field_lines = new Map<string, number>()
	if (doc.contents !== null) {
		for (const pair of doc.contents.items) {
			if (!isScalar(pair.key) || typeof pair.key.value !== 'string' || !pair.key.range) {
				continue
			}
			const prefix = yaml_content.slice(0, pair.key.range[0])
			const yaml_line_0based = prefix.split('\n').length - 1
			field_lines.set(pair.key.value, yaml_line_0based + 2)
		}
	}

	return {kind: 'ok', fields, body, field_lines}
}

// * validate_frontmatter_field
// ** Constants
const NAME_MAX = 64
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const DESCRIPTION_MAX = 1024
const COMPATIBILITY_MAX = 500

// ** Helpers
function validate_name_field(value: unknown, line: number): FieldIssue[] {
	if (typeof value !== 'string') {
		return [{line, severity: 'error', message: 'name: expected a string'}]
	}
	const issues: FieldIssue[] = []
	if (value.length === 0) {
		issues.push({line, severity: 'error', message: 'name: must not be empty'})
	} else {
		if (value.length > NAME_MAX) {
			issues.push({line, severity: 'error', message: `name: exceeds ${NAME_MAX} characters`})
		}
		if (!NAME_RE.test(value)) {
			issues.push({
				line,
				severity: 'error',
				message:
					'name: invalid format '
					+ '(lowercase letters, digits, single non-leading and non-trailing hyphens)',
			})
		}
	}
	return issues
}

function validate_description_field(value: unknown, line: number): FieldIssue[] {
	if (typeof value !== 'string') {
		return [{line, severity: 'error', message: 'description: expected a string'}]
	}
	const issues: FieldIssue[] = []
	if (value.length === 0) {
		issues.push({line, severity: 'error', message: 'description: must not be empty'})
	} else if (value.length > DESCRIPTION_MAX) {
		issues.push({
			line,
			severity: 'error',
			message: `description: exceeds ${DESCRIPTION_MAX} characters`,
		})
	}
	return issues
}

function validate_license_field(value: unknown, line: number): FieldIssue[] {
	if (typeof value !== 'string') {
		return [{line, severity: 'error', message: 'license: expected a string'}]
	}
	return []
}

function validate_compatibility_field(value: unknown, line: number): FieldIssue[] {
	if (typeof value !== 'string') {
		return [{line, severity: 'error', message: 'compatibility: expected a string'}]
	}
	if (value.length === 0) {
		return [{line, severity: 'error', message: 'compatibility: must not be empty'}]
	}
	if (value.length > COMPATIBILITY_MAX) {
		return [{
			line,
			severity: 'error',
			message: `compatibility: exceeds ${COMPATIBILITY_MAX} characters`,
		}]
	}
	return []
}

function validate_metadata_field(value: unknown, line: number): FieldIssue[] {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return [{line, severity: 'error', message: 'metadata: expected a YAML mapping'}]
	}
	return []
}

function validate_allowed_tools_field(value: unknown, line: number): FieldIssue[] {
	if (typeof value !== 'string') {
		return [{
			line,
			severity: 'error',
			message: 'allowed-tools: expected a string, not a YAML list or mapping',
		}]
	}
	return []
}

// ** FIELD_VALIDATORS
type FieldValidator = (value: unknown, line: number) => FieldIssue[]

const FIELD_VALIDATORS: Record<string, FieldValidator> = {
	'name': validate_name_field,
	'description': validate_description_field,
	'license': validate_license_field,
	'compatibility': validate_compatibility_field,
	'metadata': validate_metadata_field,
	'allowed-tools': validate_allowed_tools_field,
}

export const KNOWN_FIELDS = new Set(Object.keys(FIELD_VALIDATORS))

// ** validate_frontmatter_field
export function validate_frontmatter_field(
	key: string, value: unknown, line: number,
): FieldIssue[] {
	return FIELD_VALIDATORS[key]?.(value, line) ?? []
}

// * validate_frontmatter
const REQUIRED_FIELDS = ['name', 'description'] as const

export function validate_frontmatter(
	fields: Record<string, unknown>,
	field_lines: Map<string, number>,
	skill_dir_name: string,
): FieldIssue[] {
	const issues: FieldIssue[] = []

	for (const required of REQUIRED_FIELDS) {
		if (!(required in fields)) {
			issues.push({
				line: 0,
				severity: 'error',
				message: `${required}: required field is missing`,
			})
		}
	}

	// For each present field: validate known ones, warn on unknown ones (with typo hint).
	const known_field_list = [...KNOWN_FIELDS]
	for (const [key, value] of Object.entries(fields)) {
		const line = field_lines.get(key)!
		if (KNOWN_FIELDS.has(key)) {
			issues.push(...validate_frontmatter_field(key, value, line))
		} else {
			const candidate = closestMatch(key, known_field_list, {maxDistance: 2})
			if (candidate !== undefined) {
				issues.push({
					line,
					severity: 'warning',
					message: `unknown field "${key}" (did you mean "${candidate}"?)`,
				})
			}
		}
	}

	// Cross-field: name must match skill directory name
	if (typeof fields.name === 'string' && fields.name.length > 0) {
		const line = field_lines.get('name')!
		if (fields.name !== skill_dir_name) {
			issues.push({
				line,
				severity: 'error',
				message:
					`name: "${fields.name}" does not match `
					+ `skill directory name "${skill_dir_name}"`,
			})
		}
	}

	return issues
}
