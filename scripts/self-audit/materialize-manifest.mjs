#!/usr/bin/env node
/**
 * Self-audit: materialise the vendor-integrity gate input for CI.
 *
 * CI checks out the PUBLIC repository, where the audit manifest
 * `audit/vendor-inventory.sha256` is a committed gate artifact (it hashes
 * only the public vendor trees). This step runs BEFORE the test suite and
 * verifies the manifest is materialised: present at the expected path,
 * well-formed (sha256sum-style lines), non-trivially sized, and covering
 * every vendored root. If the manifest is missing or malformed, CI fails
 * here with an actionable message instead of letting the integrity suite
 * skip itself.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const MANIFEST = path.join(ROOT, 'audit', 'vendor-inventory.sha256')
const VENDOR_ROOTS = ['skills', 'scripts', 'references', 'models', 'templates']
// Mirrors the suspiciously-small floor asserted in tests/vendor-integrity.test.js.
const MIN_ENTRIES = 300

function fail(message) {
  console.error(`[materialize-manifest] FAIL: ${message}`)
  console.error('[materialize-manifest] repair: restore the committed audit/vendor-inventory.sha256, or regenerate it in the working folder (node scripts/self-audit/regen-manifest.mjs) and commit it.')
  process.exit(1)
}

let raw
try {
  raw = readFileSync(MANIFEST, 'utf8')
} catch {
  fail(`the audit manifest ${MANIFEST} is not materialised in this checkout; the gate input is missing before the test suite runs`)
}

const lines = raw.trim().split('\n')
const lineRe = /^([0-9a-f]{64})\s\s(\S+)$/
const entries = new Map()
for (const line of lines) {
  const match = lineRe.exec(line)
  if (!match) fail(`malformed manifest line: ${JSON.stringify(line)}`)
  entries.set(match[2], match[1])
}

if (entries.size <= MIN_ENTRIES) {
  fail(`manifest covers only ${entries.size} files; expected more than ${MIN_ENTRIES} — this is not the vendored-tree inventory`)
}
for (const root of VENDOR_ROOTS) {
  const covered = [...entries.keys()].some((rel) => rel === root || rel.startsWith(`${root}/`))
  if (!covered) fail(`manifest covers no files under ${root}/ — a vendored root is missing from the inventory`)
}
if (!entries.has('LICENSE')) fail('manifest covers no LICENSE — the legal file is missing from the inventory')

console.log(`[materialize-manifest] OK: ${MANIFEST} materialised — ${entries.size} entries, every vendor root and LICENSE covered`)
