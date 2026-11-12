/**
 * Mulqi Better Harness — Codex session-adapter discovery gate.
 *
 * Pins the contract that the Codex session adapter must read the artifacts
 * the host actually writes: rollout transcripts under
 * <codex-home>/sessions/<YYYY-MM-DD>/rollout-<date>T<time>-<id>.jsonl,
 * identified from the first record's session_meta (payload.id) and eligible
 * when that record's payload.cwd matches the scoped workspace. A rollout
 * whose recorded cwd falls outside the workspace routes to user-global and
 * is dropped under the default (no --include-global-capabilities), so the
 * fixture's session_meta carries the fixture workspace. Drift in the
 * rollout layout, the first-record identity gate, or the cwd planning-scope
 * gate silently yields zero sessions with no diagnostic, and this test
 * fails instead.
 */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { CodexSessionAnalyzer } from '../scripts/session-analysis/platforms/codex.mjs'

const FIXTURES = path.resolve(fileURLToPath(new URL('./fixtures/session-analysis/codex/', import.meta.url)))

const FIXTURE_SESSION_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
const FIXTURE_WORKSPACE = '/home/fixture-codex/ws1'
// The rollout filename the host writes beside the date folder; the artifact
// fixture is stored under this same host name (see fixtures.json sidecar).
const FIXTURE_ROLLOUT = `rollout-2026-07-01T09-30-00-${FIXTURE_SESSION_ID}.jsonl`
const FIXTURE_SESSION_DIR = '2026-07-01'

async function buildCodexHome() {
  const home = await mkdtemp(path.join(tmpdir(), 'codex-bh-adapter-'))
  const sessionDir = path.join(home, 'sessions', FIXTURE_SESSION_DIR)
  await mkdir(sessionDir, { recursive: true })
  const bytes = readFileSync(path.join(FIXTURES, FIXTURE_ROLLOUT))
  await writeFile(path.join(sessionDir, FIXTURE_ROLLOUT), bytes)
  return home
}

async function discover() {
  const home = await buildCodexHome()
  const analyzer = new CodexSessionAnalyzer()
  const scope = await analyzer.resolveScope({ home, workspace: FIXTURE_WORKSPACE })
  const roots = await analyzer.discoverSourceRoots(scope)
  const sessions = await analyzer.discoverSessions(scope, roots)
  return { home, sessions, roots }
}

test('a rollout with a session_meta identity record is read as an eligible session', async () => {
  const { home, sessions, roots } = await discover()
  assert.ok(roots.some((root) => root.exists === true), 'the staged sessions root must be discovered')
  assert.ok(sessions.length >= 1, `expected at least one eligible session, got ${sessions.length}`)
  assert.equal(sessions[0].sessionId, FIXTURE_SESSION_ID)
  await rm(home, { recursive: true, force: true })
})
