#!/usr/bin/env node
/**
 * Self-audit: regenerate the vendor-integrity gate input (working folder).
 *
 * Recomputes `audit/vendor-inventory.sha256` from the current vendored
 * trees and writes it in sha256sum format (`<sha256>  <relpath>`, two
 * spaces, one line per file), in the same walk order the integrity test
 * uses so unchanged lines stay unchanged.
 *
 * Run this in the private audit workspace whenever the vendor trees
 * change, then commit the refreshed manifest so CI's materialise step and
 * the integrity suite keep gating on the same inventory.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

for (const root of VENDOR_ROOTS) {
  if (!existsSync(path.join(ROOT, root))) {
    console.error(`[regen-manifest] FAIL: vendored root ${root}/ is missing from ${ROOT} — refusing to write a partial manifest`)
    process.exit(1)
  }
}

const entries = []
for (const root of VENDOR_ROOTS) {
  for (const file of walk(path.join(ROOT, root))) {
    const rel = path.relative(ROOT, file)
    const sha = createHash('sha256').update(readFileSync(file)).digest('hex')
    entries.push(`${sha}  ${rel}`)
  }
}
const licenseSha = createHash('sha256').update(readFileSync(path.join(ROOT, 'LICENSE'))).digest('hex')
entries.push(`${licenseSha}  LICENSE`)

mkdirSync(path.dirname(MANIFEST), { recursive: true })
writeFileSync(MANIFEST, entries.join('\n') + '\n')
console.log(`[regen-manifest] wrote ${MANIFEST}: ${entries.length} entries (${entries.length - 1} vendored files + LICENSE)`)
