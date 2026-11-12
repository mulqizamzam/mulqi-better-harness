/**
 * Mulqi Better Harness — Augment session-adapter discovery gate.
 *
 * Pins the contract that the Augment/Auggie session adapter must read the
 * artifacts the host actually writes: a session document at
 * <augment-home>/sessions/<sessionId>.json, eligible only when every IDE
 * workspace-folder root (falling back to terminal cwd) recorded inside the
 * chatHistory request nodes matches the scoped workspace, and when the
 * sessionId inside the document is honored. A matcher that drops the
 * workspace-evidence gate, renames the expected layout, or adds a
 * version-style name gate (like the one the DSH adapter once had) silently
 * yields zero sessions with no diagnostic, and this test fails instead.
 */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { AugmentSessionAnalyzer } from '../scripts/session-analysis/platforms/augment.mjs'

const FIXTURES = path.resolve(fileURLToPath(new URL('./fixtures/session-analysis/augment/', import.meta.url)))

const FIXTURE_SESSION_ID = '2e9d8c7b-6a5f-4e3d-bc1a-0f9e8d7c6b5a'
const FIXTURE_WORKSPACE = '/home/fixture-augment/ws1'

async function buildAugmentHome() {
  const home = await mkdtemp(path.join(tmpdir(), 'augment-bh-adapter-'))
  const sessionsDir = path.join(home, 'sessions')
  await mkdir(sessionsDir, { recursive: true })
  const artifactName = `${FIXTURE_SESSION_ID}.json`
  const bytes = readFileSync(path.join(FIXTURES, artifactName))
  await writeFile(path.join(sessionsDir, artifactName), bytes)
  return home
}

async function discover() {
  const home = await buildAugmentHome()
  const analyzer = new AugmentSessionAnalyzer()
  const scope = await analyzer.resolveScope({ home, workspace: FIXTURE_WORKSPACE })
  const roots = await analyzer.discoverSourceRoots(scope)
  const sessions = await analyzer.discoverSessions(scope, roots)
  return { home, sessions, roots }
}

test('a session document with workspace-folder evidence is read as an eligible session', async () => {
  const { home, sessions, roots } = await discover()
  assert.ok(roots.some((root) => root.exists === true), 'the staged sessions root must be discovered')
  assert.ok(sessions.length >= 1, `expected at least one eligible session, got ${sessions.length}`)
  assert.equal(sessions[0].sessionId, FIXTURE_SESSION_ID)
  await rm(home, { recursive: true, force: true })
})
