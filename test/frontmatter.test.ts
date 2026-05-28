// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {extract_frontmatter, validate_frontmatter_field, validate_frontmatter} from '../src/frontmatter.ts'

// * extract_frontmatter

// ** kind: 'none'

test('extract_frontmatter: empty file → none', () => {
	assert.deepStrictEqual(extract_frontmatter(''), {kind: 'none', body_start_line: 0})
})

test('extract_frontmatter: no frontmatter → none', () => {
	assert.deepStrictEqual(extract_frontmatter('# Heading\n\nBody text.\n'), {kind: 'none', body_start_line: 0})
})

test('extract_frontmatter: --- not at column 0 → none', () => {
	assert.deepStrictEqual(extract_frontmatter(' ---\nname: aqq\n---\n'), {kind: 'none', body_start_line: 0})
})

// ** kind: 'error'

test('extract_frontmatter: unclosed frontmatter → error', () => {
	const result = extract_frontmatter('---\nname: aqq\n')
	assert.equal(result.kind, 'error')
	if (result.kind !== 'error') {
		return
	}
	assert.equal(result.message, 'unclosed frontmatter (no closing --- or ...)')
})

test('extract_frontmatter: invalid YAML → error', () => {
	const result = extract_frontmatter('---\n: bad: yaml:\n---\n')
	assert.equal(result.kind, 'error')
	if (result.kind !== 'error') {
		return
	}
	assert.ok(result.message.startsWith('invalid YAML in frontmatter:'))
})

test('extract_frontmatter: non-mapping YAML (sequence) → error', () => {
	const result = extract_frontmatter('---\n- item\n- item2\n---\n')
	assert.equal(result.kind, 'error')
	if (result.kind !== 'error') {
		return
	}
	assert.equal(result.message, 'frontmatter must be a YAML mapping')
})

test('extract_frontmatter: duplicate key → error', () => {
	const result = extract_frontmatter('---\nname: aqq\nname: bęc\n---\n')
	assert.equal(result.kind, 'error')
	if (result.kind !== 'error') {
		return
	}
	assert.ok(result.message.startsWith('invalid YAML in frontmatter: Map keys must be unique'))
})

// ** kind: 'ok' — fields and body

test('extract_frontmatter: minimal valid frontmatter', () => {
	const result = extract_frontmatter([
		'---',
		'name: my-skill',
		'description: Does things.',
		'---',
		'',
	].join('\n'))
	assert.equal(result.kind, 'ok')
	if (result.kind !== 'ok') {
		return
	}
	assert.deepStrictEqual(result.fields, {name: 'my-skill', description: 'Does things.'})
})

test('extract_frontmatter: body after frontmatter', () => {
	const result = extract_frontmatter([
		'---',
		'name: my-skill',
		'description: Does things.',
		'---',
		'',
		'## Instructions',
		'',
	].join('\n'))
	assert.equal(result.kind, 'ok')
	if (result.kind !== 'ok') {
		return
	}
	assert.equal(result.body_start_line, 4)
})

test('extract_frontmatter: closing ... is accepted', () => {
	const result = extract_frontmatter([
		'---',
		'name: my-skill',
		'description: Does things.',
		'...',
		'body',
	].join('\n'))
	assert.equal(result.kind, 'ok')
	if (result.kind !== 'ok') {
		return
	}
	assert.equal(result.body_start_line, 4)
})

test('extract_frontmatter: trailing whitespace on --- accepted', () => {
	const result = extract_frontmatter([
		'---  ',
		'name: aqq',
		'description: bęc',
		'---  ',
		'',
	].join('\n'))
	assert.equal(result.kind, 'ok')
})

test('extract_frontmatter: empty frontmatter block → ok with empty fields', () => {
	const result = extract_frontmatter([
		'---',
		'---',
		'body',
		'',
	].join('\n'))
	assert.equal(result.kind, 'ok')
	if (result.kind !== 'ok') {
		return
	}
	assert.deepStrictEqual(result.fields, {})
	assert.equal(result.body_start_line, 2)
})

test('extract_frontmatter: metadata nested mapping preserved', () => {
	const result = extract_frontmatter([
		'---',
		'name: my-skill',
		'description: Does things.',
		'metadata:',
		'  author: alice',
		'  version: "1.0"',
		'---',
		'',
	].join('\n'))
	assert.equal(result.kind, 'ok')
	if (result.kind !== 'ok') {
		return
	}
	assert.deepStrictEqual(result.fields, {
		name: 'my-skill',
		description: 'Does things.',
		metadata: {author: 'alice', version: '1.0'},
	})
})

// ** field_lines

test('extract_frontmatter: field_lines maps keys to 1-based file line numbers', () => {
	const result = extract_frontmatter([
		'---', // line 1 (1-based)
		'name: my-skill', // line 2
		'description: x', // line 3
		'license: MIT', // line 4
		'---',
		'',
	].join('\n'))
	assert.equal(result.kind, 'ok')
	if (result.kind !== 'ok') {
		return
	}
	assert.equal(result.field_lines.get('name'), 2)
	assert.equal(result.field_lines.get('description'), 3)
	assert.equal(result.field_lines.get('license'), 4)
})

test('extract_frontmatter: field_lines only covers top-level keys', () => {
	const result = extract_frontmatter([
		'---',
		'name: my-skill',
		'description: x',
		'metadata:',
		'  author: alice',
		'---',
		'',
	].join('\n'))
	assert.equal(result.kind, 'ok')
	if (result.kind !== 'ok') {
		return
	}
	assert.ok(result.field_lines.has('metadata'))
	assert.ok(!result.field_lines.has('author'))
})

test('extract_frontmatter: integer key in frontmatter is skipped in field_lines', () => {
	const result = extract_frontmatter([
		'---',
		'42: foo',
		'name: my-skill',
		'---',
		'',
	].join('\n'))
	assert.equal(result.kind, 'ok')
	if (result.kind !== 'ok') {
		return
	}
	assert.ok(result.field_lines.has('name'))
	assert.equal(result.field_lines.size, 1)
})

test('extract_frontmatter: sequence key in frontmatter is skipped in field_lines', () => {
	const result = extract_frontmatter([
		'---',
		'? [a, b]',
		': foo',
		'name: my-skill',
		'---',
		'',
	].join('\n'))
	assert.equal(result.kind, 'ok')
	if (result.kind !== 'ok') {
		return
	}
	assert.ok(result.field_lines.has('name'))
	assert.equal(result.field_lines.size, 1)
})

test('extract_frontmatter: null key in frontmatter is skipped in field_lines', () => {
	const result = extract_frontmatter([
		'---',
		'~: foo',
		'name: my-skill',
		'---',
		'',
	].join('\n'))
	assert.equal(result.kind, 'ok')
	if (result.kind !== 'ok') {
		return
	}
	assert.ok(result.field_lines.has('name'))
	assert.equal(result.field_lines.size, 1)
})

// * validate_frontmatter_field
// ** Message constants
const NAME_EXPECTED_STRING = 'name: expected a string'
const NAME_MUST_NOT_BE_EMPTY = 'name: must not be empty'
const NAME_EXCEEDS_64 = 'name: exceeds 64 characters'
const NAME_INVALID_FORMAT
	= 'name: invalid format (lowercase letters, digits, single non-leading and non-trailing hyphens)'
const DESCRIPTION_EXPECTED_STRING = 'description: expected a string'
const DESCRIPTION_MUST_NOT_BE_EMPTY = 'description: must not be empty'
const DESCRIPTION_EXCEEDS_1024 = 'description: exceeds 1024 characters'
const LICENSE_EXPECTED_STRING = 'license: expected a string'
const COMPATIBILITY_EXPECTED_STRING = 'compatibility: expected a string'
const COMPATIBILITY_MUST_NOT_BE_EMPTY = 'compatibility: must not be empty'
const COMPATIBILITY_EXCEEDS_500 = 'compatibility: exceeds 500 characters'
const ALLOWED_TOOLS_EXPECTED_STRING = 'allowed-tools: expected a string, not a YAML list or mapping'
const METADATA_EXPECTED_MAPPING = 'metadata: expected a YAML mapping'

// ** name
test('validate_frontmatter_field: name valid → no issues', () => {
	assert.deepStrictEqual(validate_frontmatter_field('name', 'my-skill', 2), [])
})

test('validate_frontmatter_field: name valid single segment → no issues', () => {
	assert.deepStrictEqual(validate_frontmatter_field('name', 'mysk1ll', 2), [])
})

test('validate_frontmatter_field: name non-string → error', () => {
	const issues = validate_frontmatter_field('name', 42, 2)
	assert.equal(issues.length, 1)
	assert.equal(issues[0].severity, 'error')
	assert.equal(issues[0].message, NAME_EXPECTED_STRING)
	assert.equal(issues[0].line, 2)
})

test('validate_frontmatter_field: name null → error', () => {
	const issues = validate_frontmatter_field('name', null, 2)
	assert.equal(issues.length, 1)
	assert.equal(issues[0].severity, 'error')
	assert.equal(issues[0].message, NAME_EXPECTED_STRING)
})

test('validate_frontmatter_field: name empty string → error', () => {
	const issues = validate_frontmatter_field('name', '', 2)
	assert.equal(issues.length, 1)
	assert.equal(issues[0].severity, 'error')
	assert.equal(issues[0].message, NAME_MUST_NOT_BE_EMPTY)
})

test('validate_frontmatter_field: name exceeds 64 chars → error', () => {
	const issues = validate_frontmatter_field('name', 'a'.repeat(65), 2)
	assert.equal(issues.length, 1)
	assert.equal(issues[0].severity, 'error')
	assert.equal(issues[0].message, NAME_EXCEEDS_64)
})

test('validate_frontmatter_field: name exactly 64 chars → no issues', () => {
	// 'a' + 31×'-a' + 'a' = 1 + 62 + 1 = 64 chars
	const name = 'a' + '-a'.repeat(31) + 'a'
	assert.equal(name.length, 64)
	assert.deepStrictEqual(validate_frontmatter_field('name', name, 2), [])
})

test('validate_frontmatter_field: name with uppercase → error', () => {
	const issues = validate_frontmatter_field('name', 'MySkill', 2)
	assert.equal(issues.length, 1)
	assert.equal(issues[0].severity, 'error')
	assert.equal(issues[0].message, NAME_INVALID_FORMAT)
})

test('validate_frontmatter_field: name with leading hyphen → error', () => {
	const issues = validate_frontmatter_field('name', '-my-skill', 2)
	assert.equal(issues.length, 1)
	assert.equal(issues[0].severity, 'error')
	assert.equal(issues[0].message, NAME_INVALID_FORMAT)
})

test('validate_frontmatter_field: name with trailing hyphen → error', () => {
	const issues = validate_frontmatter_field('name', 'my-skill-', 2)
	assert.equal(issues.length, 1)
	assert.equal(issues[0].severity, 'error')
	assert.equal(issues[0].message, NAME_INVALID_FORMAT)
})

test('validate_frontmatter_field: name with consecutive hyphens → error', () => {
	const issues = validate_frontmatter_field('name', 'my--skill', 2)
	assert.equal(issues.length, 1)
	assert.equal(issues[0].severity, 'error')
	assert.equal(issues[0].message, NAME_INVALID_FORMAT)
})

test('validate_frontmatter_field: name too long AND invalid format → two errors', () => {
	const issues = validate_frontmatter_field('name', 'A'.repeat(65), 2)
	assert.equal(issues.length, 2)
	assert.equal(issues[0].message, NAME_EXCEEDS_64)
	assert.equal(issues[1].message, NAME_INVALID_FORMAT)
})

// ** description
test('validate_frontmatter_field: description valid → no issues', () => {
	assert.deepStrictEqual(validate_frontmatter_field('description', 'Does things.', 3), [])
})

test('validate_frontmatter_field: description non-string → error', () => {
	const issues = validate_frontmatter_field('description', ['a'], 3)
	assert.equal(issues.length, 1)
	assert.equal(issues[0].severity, 'error')
	assert.equal(issues[0].message, DESCRIPTION_EXPECTED_STRING)
	assert.equal(issues[0].line, 3)
})

test('validate_frontmatter_field: description null → error', () => {
	const issues = validate_frontmatter_field('description', null, 3)
	assert.equal(issues.length, 1)
	assert.equal(issues[0].severity, 'error')
	assert.equal(issues[0].message, DESCRIPTION_EXPECTED_STRING)
})

test('validate_frontmatter_field: description empty string → error', () => {
	const issues = validate_frontmatter_field('description', '', 3)
	assert.equal(issues.length, 1)
	assert.equal(issues[0].severity, 'error')
	assert.equal(issues[0].message, DESCRIPTION_MUST_NOT_BE_EMPTY)
})

test('validate_frontmatter_field: description exceeds 1024 chars → error', () => {
	const issues = validate_frontmatter_field('description', 'x'.repeat(1025), 3)
	assert.equal(issues.length, 1)
	assert.equal(issues[0].severity, 'error')
	assert.equal(issues[0].message, DESCRIPTION_EXCEEDS_1024)
})

test('validate_frontmatter_field: description exactly 1024 chars → no issues', () => {
	assert.deepStrictEqual(validate_frontmatter_field('description', 'x'.repeat(1024), 3), [])
})

// ** license
test('validate_frontmatter_field: license valid string → no issues', () => {
	assert.deepStrictEqual(validate_frontmatter_field('license', 'MIT', 5), [])
})

test('validate_frontmatter_field: license non-string → error', () => {
	const issues = validate_frontmatter_field('license', 42, 5)
	assert.equal(issues.length, 1)
	assert.equal(issues[0].severity, 'error')
	assert.equal(issues[0].message, LICENSE_EXPECTED_STRING)
})

// ** compatibility
test('validate_frontmatter_field: compatibility valid string → no issues', () => {
	assert.deepStrictEqual(validate_frontmatter_field('compatibility', 'Requires Node 20+', 5), [])
})

test('validate_frontmatter_field: compatibility non-string → error', () => {
	const issues = validate_frontmatter_field('compatibility', null, 5)
	assert.equal(issues.length, 1)
	assert.equal(issues[0].severity, 'error')
	assert.equal(issues[0].message, COMPATIBILITY_EXPECTED_STRING)
})

test('validate_frontmatter_field: compatibility empty string → error', () => {
	const issues = validate_frontmatter_field('compatibility', '', 5)
	assert.equal(issues.length, 1)
	assert.equal(issues[0].severity, 'error')
	assert.equal(issues[0].message, COMPATIBILITY_MUST_NOT_BE_EMPTY)
})

test('validate_frontmatter_field: compatibility exceeds 500 chars → error', () => {
	const issues = validate_frontmatter_field('compatibility', 'x'.repeat(501), 5)
	assert.equal(issues.length, 1)
	assert.equal(issues[0].severity, 'error')
	assert.equal(issues[0].message, COMPATIBILITY_EXCEEDS_500)
})

test('validate_frontmatter_field: compatibility exactly 500 chars → no issues', () => {
	assert.deepStrictEqual(validate_frontmatter_field('compatibility', 'x'.repeat(500), 5), [])
})

// ** metadata
test('validate_frontmatter_field: metadata valid mapping → no issues', () => {
	assert.deepStrictEqual(validate_frontmatter_field('metadata', {author: 'alice'}, 5), [])
})

test('validate_frontmatter_field: metadata empty mapping → no issues', () => {
	assert.deepStrictEqual(validate_frontmatter_field('metadata', {}, 5), [])
})

test('validate_frontmatter_field: metadata scalar → error', () => {
	const issues = validate_frontmatter_field('metadata', 'not a mapping', 5)
	assert.equal(issues.length, 1)
	assert.equal(issues[0].severity, 'error')
	assert.equal(issues[0].message, METADATA_EXPECTED_MAPPING)
})

test('validate_frontmatter_field: metadata list → error', () => {
	const issues = validate_frontmatter_field('metadata', ['a', 'b'], 5)
	assert.equal(issues.length, 1)
	assert.equal(issues[0].severity, 'error')
	assert.equal(issues[0].message, METADATA_EXPECTED_MAPPING)
})

test('validate_frontmatter_field: metadata null → error', () => {
	const issues = validate_frontmatter_field('metadata', null, 5)
	assert.equal(issues.length, 1)
	assert.equal(issues[0].severity, 'error')
	assert.equal(issues[0].message, METADATA_EXPECTED_MAPPING)
})

// ** allowed-tools
test('validate_frontmatter_field: allowed-tools valid string → no issues', () => {
	assert.deepStrictEqual(validate_frontmatter_field('allowed-tools', 'Bash Read Write', 4), [])
})

test('validate_frontmatter_field: allowed-tools YAML list → error', () => {
	const issues = validate_frontmatter_field('allowed-tools', ['Bash', 'Read'], 4)
	assert.equal(issues.length, 1)
	assert.equal(issues[0].severity, 'error')
	assert.equal(issues[0].message, ALLOWED_TOOLS_EXPECTED_STRING)
	assert.equal(issues[0].line, 4)
})

test('validate_frontmatter_field: allowed-tools mapping → error', () => {
	const issues = validate_frontmatter_field('allowed-tools', {Bash: true}, 4)
	assert.equal(issues.length, 1)
	assert.equal(issues[0].severity, 'error')
	assert.equal(issues[0].message, ALLOWED_TOOLS_EXPECTED_STRING)
})

// ** unknown field
test('validate_frontmatter_field: unknown field → no issues', () => {
	assert.deepStrictEqual(validate_frontmatter_field('unknown-key', 'anything', 5), [])
})

// * validate_frontmatter

// Helper: build field_lines with each key at line 2 unless overridden
function make_field_lines(fields: Record<string, unknown>, overrides: Record<string, number> = {}): Map<string, number> {
	const map = new Map<string, number>()
	for (const key of Object.keys(fields)) {
		map.set(key, overrides[key] ?? 2)
	}
	return map
}

// ** required fields

test('validate_frontmatter: valid minimal skill → no issues', () => {
	const fields = {name: 'my-skill', description: 'Does things.'}
	const issues = validate_frontmatter(fields, make_field_lines(fields), 'my-skill')
	assert.deepStrictEqual(issues, [])
})

test('validate_frontmatter: name missing → error at line 0', () => {
	const fields = {description: 'Does things.'}
	const issues = validate_frontmatter(fields, make_field_lines(fields), 'my-skill')
	assert.deepStrictEqual(issues, [{line: 0, severity: 'error', message: 'name: required field is missing'}])
})

test('validate_frontmatter: description missing → error at line 0', () => {
	const fields = {name: 'my-skill'}
	const issues = validate_frontmatter(fields, make_field_lines(fields), 'my-skill')
	assert.deepStrictEqual(issues, [{line: 0, severity: 'error', message: 'description: required field is missing'}])
})

test('validate_frontmatter: both required fields missing → two errors', () => {
	const fields = {}
	const issues = validate_frontmatter(fields, make_field_lines(fields), 'my-skill')
	assert.deepStrictEqual(issues, [
		{line: 0, severity: 'error', message: 'name: required field is missing'},
		{line: 0, severity: 'error', message: 'description: required field is missing'},
	])
})

// ** per-field validation (delegated to validate_frontmatter_field)

test('validate_frontmatter: name wrong type → error', () => {
	const fields = {name: 42, description: 'Does things.'}
	const issues = validate_frontmatter(fields, make_field_lines(fields), 'my-skill')
	assert.deepStrictEqual(issues, [{line: 2, severity: 'error', message: 'name: expected a string'}])
})

test('validate_frontmatter: description empty → error', () => {
	const fields = {name: 'my-skill', description: ''}
	const issues = validate_frontmatter(fields, make_field_lines(fields), 'my-skill')
	assert.deepStrictEqual(issues, [{line: 2, severity: 'error', message: 'description: must not be empty'}])
})

test('validate_frontmatter: optional fields valid → no extra issues', () => {
	const fields = {
		'name': 'my-skill',
		'description': 'Does things.',
		'license': 'MIT',
		'compatibility': 'claude-3',
		'metadata': {author: 'me'},
		'allowed-tools': 'Bash Read',
	}
	const issues = validate_frontmatter(fields, make_field_lines(fields), 'my-skill')
	assert.deepStrictEqual(issues, [])
})

// ** cross-field: name vs skill_dir_name

test('validate_frontmatter: name does not match dir → error at field line', () => {
	const fields = {name: 'my-skill', description: 'Does things.'}
	const field_lines = make_field_lines(fields, {name: 7})
	const issues = validate_frontmatter(fields, field_lines, 'other-skill')
	assert.deepStrictEqual(issues, [{
		line: 7,
		severity: 'error',
		message: 'name: "my-skill" does not match skill directory name "other-skill"',
	}])
})

// ** unknown fields and typo detection

test('validate_frontmatter: unknown field, no close match → no issue', () => {
	// "aqq" is ≥ 4 edits from every known field — silently ignored
	const fields = {name: 'my-skill', description: 'Does things.', aqq: 'bęc'}
	const issues = validate_frontmatter(fields, make_field_lines(fields), 'my-skill')
	assert.deepStrictEqual(issues, [])
})

test('validate_frontmatter: typo in field name (1 edit) → warning with suggestion at field line', () => {
	const fields = {name: 'my-skill', description: 'Does things.', nme: 'my-skill'}
	const field_lines = make_field_lines(fields, {nme: 5})
	const issues = validate_frontmatter(fields, field_lines, 'my-skill')
	assert.deepStrictEqual(issues, [{line: 5, severity: 'warning', message: 'unknown field "nme" (did you mean "name"?)'}])
})

test('validate_frontmatter: typo in field name (2 edits) → warning with suggestion', () => {
	// "metdatas" is 2 edits from "metadata" (verified with leven)
	const fields = {name: 'my-skill', description: 'Does things.', metdatas: {x: 1}}
	const issues = validate_frontmatter(fields, make_field_lines(fields), 'my-skill')
	assert.deepStrictEqual(issues, [{line: 2, severity: 'warning', message: 'unknown field "metdatas" (did you mean "metadata"?)'}])
})
