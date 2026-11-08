/**
 * Mulqi Better Harness — provider suite.
 *
 * Proves the bundled provider publishes exactly the canonical skill with the
 * exact catalog shape the host registry accepts, and that every fail-closed
 * path drops the skill with a warning instead of publishing it mis-read.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CUSTOM_SKILL_RANK,
  deriveInvocation,
  makeProvider,
  parseFrontmatter,
  PROVIDER_NAME,
  SKILL_NAME,
} from '../lib/provider.js'

const SKILL_FILE = fileURLToPath(new URL('../skills/better-harness/SKILL.md', import.meta.url))
const SKILL_DIR = fileURLToPath(new URL('../skills/better-harness/', import.meta.url))
const PACKAGED = { skillFile: SKILL_FILE, skillDirectory: SKILL_DIR }

function warnings() {
  const list = []
  return { logger: { warn: (m) => list.push(m), info: () => {} }, list }
}

test('the shipped SKILL.md parses with the expected fields and a clean body', () => {
  const raw = readFileSync(SKILL_FILE, 'utf8')
  const parsed = parseFrontmatter(raw)
  assert.ok(parsed, 'frontmatter is parsable')
  assert.equal(parsed.fields.name, SKILL_NAME)
  assert.ok(parsed.fields.description.length > 0, 'description present')
  assert.equal(parsed.unsupported.length, 0)
  assert.ok(parsed.body.trim().startsWith('#'), 'body starts with a markdown heading')
})

test('list() publishes one candidate with the exact catalog shape', async () => {
  const { list } = warnings()
  const provider = makeProvider(PACKAGED, { logger: list.logger })
  assert.equal(provider.name, PROVIDER_NAME)
  const candidates = await provider.list()
  assert.equal(candidates.length, 1, 'exactly one skill, no warnings: ' + list.join(' | '))
  const [entry] = candidates
  assert.equal(entry.name, SKILL_NAME)
  assert.equal(entry.source, 'custom')
  assert.equal(entry.provider, PROVIDER_NAME)
  assert.equal(entry.rank, CUSTOM_SKILL_RANK)
  assert.equal(entry.path, SKILL_FILE)
  assert.deepEqual(entry.resourceBase, { kind: 'directory', path: SKILL_DIR })
  assert.deepEqual(entry.invocation, { modelInvocable: true, userInvocable: true })
  assert.equal(typeof entry.description, 'string')
  assert.ok(entry.description.length > 0)
})

test('get() returns the full definition and rejects a foreign candidate', async () => {
  const provider = makeProvider(PACKAGED, { logger: warnings().logger })
  const [candidate] = await provider.list()
  const definition = await provider.get(candidate)
  assert.ok(definition, 'definition returned for its own candidate')
  assert.equal(definition.name, SKILL_NAME)
  assert.ok(definition.content.length > 0, 'body content is loaded')
  assert.equal(definition.content.endsWith('\n'), false, 'content is trimmed')
  assert.deepEqual(definition.invocation, { modelInvocable: true, userInvocable: true })
  assert.equal(await provider.get({ ...candidate, name: 'other-skill' }), undefined)
  assert.equal(await provider.get(undefined), undefined)
})

test('a missing skill file drops the skill with a warning', async () => {
  const w = warnings()
  const provider = makeProvider({ skillFile: '/nonexistent/SKILL.md', skillDirectory: '/nonexistent' }, { logger: w.logger })
  assert.deepEqual(await provider.list(), [])
  assert.ok(w.list.some((entry) => entry.includes('cannot read')), 'warning recorded')
})

test('a name mismatch drops the skill with a warning', async () => {
  const os = await import('node:os')
  const fs = await import('node:fs')
  const dir = fs.mkdtempSync(`${os.tmpdir()}/mulqi-bh-test-`)
  fs.mkdirSync(`${dir}/skills/better-harness`, { recursive: true })
  fs.writeFileSync(`${dir}/skills/better-harness/SKILL.md`, [
    '---',
    'name: somebody-elses-skill',
    'description: not the canonical skill',
    '---',
    '# Body',
  ].join('\n'))
  const w = warnings()
  const provider = makeProvider({ skillFile: `${dir}/skills/better-harness/SKILL.md`, skillDirectory: `${dir}/skills/better-harness` }, { logger: w.logger })
  assert.deepEqual(await provider.list(), [])
  assert.ok(w.list.some((entry) => entry.includes('declares name')), 'reason recorded')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('frontmatter without a closing fence is not frontmatter-shaped', () => {
  assert.equal(parseFrontmatter('---\nname: x\ndescription: y\n# body'), undefined)
  assert.equal(parseFrontmatter('no fence at all'), undefined)
})

test('folded block scalars are parsed as strings', () => {
  const parsed = parseFrontmatter(['---', 'name: demo', 'description: >-', '  first line', '  second line', '---', '# Body'].join('\n'))
  assert.ok(parsed)
  assert.equal(parsed.fields.description, 'first line second line')
  assert.equal(parsed.unsupported.length, 0)
})

test('deriveInvocation honors the DSH boolean vocabulary and defaults', () => {
  const { invocation } = deriveInvocation({})
  assert.deepEqual(invocation, { modelInvocable: true, userInvocable: true })
  assert.deepEqual(
    deriveInvocation({ 'user-invocable': 'false' }).invocation,
    { modelInvocable: true, userInvocable: false },
  )
  assert.deepEqual(
    deriveInvocation({ 'disable-model-invocation': 'on' }).invocation,
    { modelInvocable: false, userInvocable: true },
  )
  const { invalidKeys } = deriveInvocation({ 'user-invocable': 'maybe' })
  assert.deepEqual(invalidKeys, ['user-invocable'])
})
