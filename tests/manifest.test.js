/**
 * Mulqi Better Harness — manifest and packaging suite.
 *
 * Pins the DSH reconcilable surface: the `dsh` block, the file whitelist,
 * the dependency pins, and the shape of the single Cordis patch row.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('the manifest declares the DSH bundle patch and an exact dsh engine pin', () => {
  assert.equal(manifest.dsh.bundle.patch, 'cordis.patch.yml')
  assert.equal(manifest.dsh.engines.dsh, '0.2.1-rc.2')
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.main, 'index.js')
})

test('the file whitelist ships the bundle entry, vendor trees, and legal files', () => {
  const required = [
    'index.js',
    'lib/**',
    'skills/**',
    'scripts/**',
    'references/**',
    'models/**',
    'templates/**',
    'cordis.patch.yml',
    'docs/**',
    'README.md',
    'LICENSE',
    'NOTICE.md',
  ]
  for (const entry of required) {
    assert.ok(manifest.files.includes(entry), `files must include ${entry}`)
  }
  // Private audit material must never ship.
  assert.ok(!manifest.files.includes('audit/**'))
  assert.ok(!manifest.files.includes('work/**'))
})

test('dependencies are exact pins and no lifecycle scripts exist', () => {
  assert.deepEqual(manifest.dependencies, {
    '@vscode/tree-sitter-wasm': '0.3.1',
    'esbuild-wasm': '0.28.2',
    yaml: '2.9.1',
  })
  for (const version of Object.values(manifest.dependencies)) {
    assert.ok(/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version), `dependency must be an exact pin, got ${version}`)
  }
  assert.ok(Object.values(manifest.dependencies).length === 3, 'exactly three pinned dependencies')
  assert.equal(manifest.peerDependencies, undefined, 'host packages must not be declared as peers')
  for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish']) {
    assert.equal(manifest.scripts?.[lifecycle], undefined, `no ${lifecycle} lifecycle script`)
  }
})

test('the bin entry points at the vendored CLI', () => {
  assert.equal(manifest.bin['mulqi-better-harness'], 'scripts/better-harness.mjs')
})

test('the cordis patch is one row naming this package', () => {
  const raw = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(raw, /^- insert:/m)
  assert.match(raw, /id: mulqi-bh/)
  assert.match(raw, /name: mulqi-better-harness/)
  assert.equal(raw.match(/- insert:/g).length, 1, 'exactly one row')
})

test('legal files are present and the NOTICE carries the required attribution', () => {
  const license = readFileSync(new URL('../LICENSE', import.meta.url), 'utf8')
  assert.match(license, /^MIT License/)
  const notice = readFileSync(new URL('../NOTICE.md', import.meta.url), 'utf8')
  assert.match(notice, /QoderAI\/better-harness/)
  assert.match(notice, /MIT License/)
})
