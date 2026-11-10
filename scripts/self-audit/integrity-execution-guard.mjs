#!/usr/bin/env node
/**
 * Self-audit: guard assertion that the vendor-integrity suite ACTUALLY
 * executed, so a skip can never be reported as a pass.
 *
 * Re-runs tests/vendor-integrity.test.js under the TAP reporter, then:
 *   - an integrity assertion that failed → the guard fails;
 *   - a skip of the assertions is only lawful in a recognised public-clone
 *     environment (see ./public-clone.mjs); anywhere else the guard fails;
 *   - when the assertions executed, the guard re-derives the comparison
 *     counts (disk walk + manifest parse), cross-checks them against the
 *     count the suite itself reported, and prints the real numbers.
 *
 * Used as a standalone step in CI (after the test suite) and by the local
 * `npm test` script.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { detectPublicClone } from './public-clone.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const MANIFEST = path.join(ROOT, 'audit', 'vendor-inventory.sha256')
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

function countDiskFiles() {
  let n = 1 // LICENSE
  for (const root of VENDOR_ROOTS) n += walk(path.join(ROOT, root)).length
  return n
}

function countManifestEntries() {
  const lines = readFileSync(MANIFEST, 'utf8').trim().split('\n')
  let n = 0
  for (const line of lines) {
    if (!/^[0-9a-f]{64}\s\s\S+$/.exec(line)) throw new Error(`malformed manifest line: ${line}`)
    n += 1
  }
  return n
}

function fail(message, tap) {
  console.error(`[integrity-execution-guard] FAIL: ${message}`)
  console.error('[integrity-execution-guard] a skip (or a no-op suite) must not be reported as a pass.')
  if (tap) {
    const tail = tap.split('\n').filter((l) => l.startsWith('not ok') || l.startsWith('# ')).slice(-25).join('\n')
    if (tail) console.error(tail)
  }
  process.exit(1)
}

const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/vendor-integrity.test.js'], {
  cwd: ROOT,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
})
const tap = run.stdout ?? ''

// Classify the TAP test lines (top-level or nested; skipped lines carry a
// `# SKIP <reason>` annotation; failed lines are `not ok N - ...`).
const executed = []
const skipped = []
const failed = []
for (const line of tap.split('\n')) {
  const m = /^\s*(ok|not ok) \d+ - (.+)$/.exec(line)
  if (!m) continue
  const name = m[2]
  if (m[1] === 'not ok') {
    failed.push(name)
    continue
  }
  const skipAt = name.search(/ # SKIP\b/)
  if (skipAt >= 0) skipped.push(name.slice(0, skipAt))
  else executed.push(name)
}

const ENV = detectPublicClone(ROOT)

if (run.status !== 0) {
  fail(`the integrity test run exited ${run.status} — an integrity assertion failed or errored`, tap)
}
if (failed.length > 0) {
  fail(`integrity assertions failed: ${failed.join('; ')}`, tap)
}

if (skipped.length > 0) {
  if (!ENV.publicClone) {
    fail(
      `${skipped.length} integrity assertion(s) skipped in an environment where they must run (${ENV.reasons.join('; ')})`,
      tap,
    )
  }
  console.log(
    `[integrity-execution-guard] integrity assertions skipped in a recognised public-clone environment: ${ENV.reasons.join('; ')}. Documented skip, not a pass; the gate is active where the manifest is materialised (CI, working folder).`,
  )
  process.exit(0)
}

if (executed.length === 0) {
  fail('the TAP output contains no executed integrity assertion and no skip — the suite did not run the gate', tap)
}

const disk = countDiskFiles()
let entries
try {
  entries = countManifestEntries()
} catch (error) {
  fail(`the manifest could not be re-parsed by the guard: ${error.message}`)
}

const reported = tap.split('\n').find((l) => l.startsWith('# vendor integrity: compared '))
if (!reported) {
  fail('the suite reported no comparison count — the comparison assertion did not reach the reporting point', tap)
}
const countMatch = /compared (\d+) disk files against (\d+) manifest entries/.exec(reported)
if (!countMatch || Number(countMatch[1]) !== disk || Number(countMatch[2]) !== entries) {
  fail(
    `reported comparison count (${reported.trim()}) disagrees with the guard's independent counts (disk ${disk}, manifest ${entries})`,
    tap,
  )
}

console.log(
  `[integrity-execution-guard] OK: vendor-integrity suite executed — compared ${disk} disk files against ${entries} manifest entries (${executed.length} assertion(s) ran, 0 skipped).`,
)
