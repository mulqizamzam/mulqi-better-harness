/**
 * Mulqi Better Harness — vendor integrity suite.
 *
 * Pins the shipped vendor trees (skills, scripts, references, models,
 * templates, LICENSE) against the audit hash manifest
 * `audit/vendor-inventory.sha256` (a committed gate artifact that hashes
 * only the public vendor trees; everything else under audit/ stays private).
 *
 * Where the gate runs:
 *   - working folder (private audit workspace): the manifest MUST exist; a
 *     missing manifest FAILS the suite with an actionable repair hint.
 *   - recognised public-clone environments (a public git clone without
 *     private workspace material, an installed/copied package): the manifest
 *     is intentionally absent, so the assertions skip themselves with a
 *     reason — the only place a skip is allowed.
 *   - CI: the workflow materialises the committed manifest
 *     (scripts/self-audit/materialize-manifest.mjs) before the suite runs,
 *     so the assertions execute there; the guard in
 *     scripts/self-audit/integrity-execution-guard.mjs re-checks execution.
 *
 * A skip must never be reported as a pass: the last test in this file runs
 * in every environment and fails whenever the assertions were skipped
 * somewhere they must run.
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { detectPublicClone } from '../scripts/self-audit/public-clone.mjs'

const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url))
const MANIFEST = path.join(PLUGIN_ROOT, 'audit', 'vendor-inventory.sha256')
const HAS_MANIFEST = existsSync(MANIFEST)

// A missing manifest may skip the suite only in a recognised public-clone
// environment; in the working folder (and in CI) it must fail instead.
const ENV = detectPublicClone(PLUGIN_ROOT)
const RECOGNISED_SKIP = !HAS_MANIFEST && ENV.publicClone

const SKIP_REASON = RECOGNISED_SKIP
  ? `recognised public-clone environment: the audit manifest is intentionally absent (${ENV.reasons.join('; ')})`
  : undefined

const REPAIR_HINT = `regenerate it in the working folder: node scripts/self-audit/regen-manifest.mjs`

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

test('the audit hash manifest exists', { skip: SKIP_REASON }, () => {
  assert.ok(
    existsSync(MANIFEST),
    `missing ${MANIFEST}; ${REPAIR_HINT}`
  )
})

test('every vendored file matches the audit manifest, with no extras', { skip: SKIP_REASON }, () => {
  assert.ok(existsSync(MANIFEST), `missing ${MANIFEST}; ${REPAIR_HINT}`)
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

  // Report the real comparison count so a green run shows the gate's work.
  console.log(`vendor integrity: compared ${actual.size} disk files against ${expected.size} manifest entries`)
})

// Guard assertion: a skip must not be reportable as a pass. This test is
// never skipped: in every environment it asserts that the integrity
// assertions above either executed (manifest present) or were skipped in a
// recognised public-clone environment — no third option exists.
test('the integrity assertions cannot be skipped where they must run', () => {
  assert.ok(
    HAS_MANIFEST || ENV.publicClone,
    'the vendor-integrity assertions were skipped without a manifest in an environment where they must run; ' +
      `a skip must not be reported as a pass. ${REPAIR_HINT}`
  )
})
