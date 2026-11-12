/**
 * Mulqi Better Harness — public-clone environment detection.
 *
 * Pins the branch outcomes of detectPublicClone (scripts/self-audit/
 * public-clone.mjs) against hermetic temp checkouts, so the only
 * recognised skip environment of the vendor-integrity gate cannot be
 * re-defined accidentally. A clean env object (no CI/GITHUB_ACTIONS)
 * and an explicit CI env are passed so host environment variables can
 * never leak into the outcomes.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { detectPublicClone } from '../scripts/self-audit/public-clone.mjs'

const PARENT = mkdtempSync(path.join(tmpdir(), 'mbh-public-clone-'))
let counter = 0
const CLEAN_ENV = {} // no CI/GITHUB_ACTIONS, whatever the host shell carries
const PUBLIC_ORIGIN = 'https://github.com/mulqizamzam/mulqi-better-harness'

function makeCheckout({ withGit, origin, withWork }) {
  const dir = path.join(PARENT, `case-${counter++}`)
  mkdirSync(dir, { recursive: true })
  if (withGit) {
    execFileSync('git', ['init', '-q', dir], { stdio: 'ignore' })
    if (origin) execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: dir, stdio: 'ignore' })
  }
  if (withWork) mkdirSync(path.join(dir, 'work'))
  return dir
}

test('CI environment is never a recognised skip, even with private material', () => {
  const dir = makeCheckout({ withGit: true, origin: PUBLIC_ORIGIN, withWork: true })
  const env = detectPublicClone(dir, { CI: 'true' })
  assert.equal(env.publicClone, false)
  assert.ok(env.reasons.some((r) => r.includes('CI environment')))
})

test('a checkout without .git of its own is a recognised public-clone', () => {
  const dir = makeCheckout({ withGit: false })
  const env = detectPublicClone(dir, CLEAN_ENV)
  assert.equal(env.publicClone, true)
  assert.ok(env.reasons.some((r) => r.includes('no .git of its own')))
})

test('a public-origin clone without private material is a recognised public-clone', () => {
  const dir = makeCheckout({ withGit: true, origin: PUBLIC_ORIGIN })
  const env = detectPublicClone(dir, CLEAN_ENV)
  assert.equal(env.publicClone, true)
  assert.ok(env.reasons.some((r) => r.includes('git clone of the public repository')))
})

test('private workspace material makes the checkout the working folder', () => {
  const dir = makeCheckout({ withGit: true, origin: PUBLIC_ORIGIN, withWork: true })
  const env = detectPublicClone(dir, CLEAN_ENV)
  assert.equal(env.publicClone, false)
  assert.ok(env.reasons.some((r) => r.includes('working folder')))
})

test('a private-origin checkout is the working folder even without material', () => {
  const dir = makeCheckout({ withGit: true, origin: 'https://gitlab.example.com/private/repo.git' })
  const env = detectPublicClone(dir, CLEAN_ENV)
  assert.equal(env.publicClone, false)
  assert.ok(env.reasons.some((r) => r.includes('origin is not the public repository')))
})

test.after(() => {
  rmSync(PARENT, { recursive: true, force: true })
})
