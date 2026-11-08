/**
 * Mulqi Better Harness — vendor integrity suite.
 *
 * Pins the shipped vendor trees (skills/better-harness, scripts, references,
 * models, templates, LICENSE) against the private audit hash manifest
 * `audit/vendor-inventory.sha256` (working folder only, not published).
 * When the manifest is absent — as in a public clone — the suite skips
 * itself with a reason instead of failing.
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url))
const MANIFEST = path.join(PLUGIN_ROOT, 'audit', 'vendor-inventory.sha256')
const HAS_MANIFEST = existsSync(MANIFEST)

if (!HAS_MANIFEST) {
  test('vendor integrity is a private gate test (audit manifest not shipped); run inside the working folder to enable it', { skip: true }, () => {})
}

const VENDOR_ROOTS = ['skills', 'scripts', 'references', 'models', 'templates']

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

test.if(HAS_MANIFEST, 'the audit hash manifest exists', () => {
  assert.ok(existsSync(MANIFEST), `missing ${MANIFEST}; regenerate it in the private audit workspace before shipping`)
})

test.if(HAS_MANIFEST, 'every vendored file matches the audit manifest, with no extras', () => {
  const lines = readFileSync(MANIFEST, 'utf8').trim().split('\n')
  const expected = new Map()
  for (const line of lines) {
    const match = /^([0-9a-f]{64})\s\s(\S+)$/.exec(line)
    assert.ok(match, `malformed manifest line: ${line}`)
    expected.set(match[2], match[1])
  }

  const actual = new Map()
  for (const root of VENDOR_ROOTS) {
    for (const file of walk(path.join(PLUGIN_ROOT, root))) {
      const rel = path.relative(PLUGIN_ROOT, file)
      actual.set(rel, createHash('sha256').update(readFileSync(file)).digest('hex'))
    }
  }
  actual.set('LICENSE', createHash('sha256').update(readFileSync(path.join(PLUGIN_ROOT, 'LICENSE'))).digest('hex'))

  const missing = [...expected.keys()].filter((rel) => !actual.has(rel))
  const extra = [...actual.keys()].filter((rel) => !expected.has(rel))
  const changed = [...actual.keys()].filter((rel) => expected.has(rel) && expected.get(rel) !== actual.get(rel))

  assert.deepEqual(missing, [], `vendored files missing from disk: ${missing.join(', ')}`)
  assert.deepEqual(extra, [], `unexpected files inside vendor trees: ${extra.join(', ')}`)
  assert.deepEqual(changed, [], `vendored files diverged from the manifest: ${changed.join(', ')}`)
  assert.ok(expected.size > 300, `manifest suspiciously small (${expected.size} files)`)
})
