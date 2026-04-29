// * Imports
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {extract_frontmatter} from '../src/frontmatter.ts'

// * extract_frontmatter

// ** kind: 'none'

test('extract_frontmatter: empty file → none', () => {
	assert.deepStrictEqual(extract_frontmatter(''), {kind: 'none'})
})

test('extract_frontmatter: no frontmatter → none', () => {
	assert.deepStrictEqual(extract_frontmatter('# Heading\n\nBody text.\n'), {kind: 'none'})
})

test('extract_frontmatter: --- not at column 0 → none', () => {
	assert.deepStrictEqual(extract_frontmatter(' ---\nname: foo\n---\n'), {kind: 'none'})
})

// ** kind: 'error'

test('extract_frontmatter: unclosed frontmatter → error', () => {
	const result = extract_frontmatter('---\nname: foo\n')
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
	assert.equal(result.body, '\n## Instructions\n')
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
	assert.equal(result.body, 'body')
})

test('extract_frontmatter: trailing whitespace on --- accepted', () => {
	const result = extract_frontmatter([
		'---  ',
		'name: foo',
		'description: bar',
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
	assert.equal(result.body, 'body\n')
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
