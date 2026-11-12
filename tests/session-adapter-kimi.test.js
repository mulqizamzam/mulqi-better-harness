/**
 * Mulqi Better Harness — KIMI session-adapter discovery gate.
 *
 * Pins the on-disk artifact shape the Kimi Code host writes: workspace dirs
 * <home>/sessions/wd_<name>_<hex>/ matched to the scope through the
 * <home>/workspaces.json index (workspace id -> root), session dirs
 * ses_<hex>/ carrying agents/<agentId>/wire.jsonl transcripts plus an
 * optional state.json (title + createdAt/updatedAt). An adapter that misses
 * any of these shapes (e.g. a matcher that no longer accepts the dir names or
 * drops the index lookup) silently yields zero sessions and no diagnostic.
 *
 * GREEN: the fixture layout yields an eligible session with the exact id.
 */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { KimiSessionAnalyzer } from '../scripts/session-analysis/platforms/kimi.mjs'

const FIXTURES = path.resolve(fileURLToPath(new URL('./fixtures/session-analysis/kimi/', import.meta.url)))
// Stable fixture workspace, referenced by the workspaces.json index entry and
// passed to resolveScope so the index match (not the wd_<name>_ fallback)
// drives discovery.
const WORKSPACE = '/home/fixture-kimi/ws1'

async function buildKimiHome() {
  const home = await mkdtemp(path.join(tmpdir(), 'kimi-bh-adapter-'))
  const sessionDir = path.join(home, 'sessions', 'wd_ws1_abcd1234', 'ses_abcd1234')
  await mkdir(path.join(sessionDir, 'agents', 'main'), { recursive: true })
  await writeFile(path.join(home, 'workspaces.json'), await readFile(path.join(FIXTURES, 'workspaces.json')))
  await writeFile(path.join(sessionDir, 'state.json'), await readFile(path.join(FIXTURES, 'state.json')))
  await writeFile(path.join(sessionDir, 'agents', 'main', 'wire.jsonl'), await readFile(path.join(FIXTURES, 'wire.jsonl')))
  return home
}

async function discover() {
  const home = await buildKimiHome()
  const analyzer = new KimiSessionAnalyzer()
  const scope = await analyzer.resolveScope({ home, workspace: WORKSPACE })
  const roots = await analyzer.discoverSourceRoots(scope)
  const sessions = await analyzer.discoverSessions(scope, roots)
  return { home, scope, sessions, roots }
}

test('the workspaces.json index maps the wd_* workspace dir to the scope', async () => {
  const { home, scope, sessions, roots } = await discover()
  assert.ok(roots.some((root) => root.exists === true), 'fixture session root must be discovered')
  assert.equal(scope._indexAbsent, false, 'workspaces.json must be loaded, not the wd_<name>_ fallback')
  assert.ok(sessions.length >= 1, `expected at least one eligible session, got ${sessions.length}`)
  assert.equal(sessions[0].sessionId, 'ses_abcd1234')
  await rm(home, { recursive: true, force: true })
})

test('state.json supplies the session title and observed time range', async () => {
  const { home, sessions } = await discover()
  assert.ok(sessions.length >= 1, `expected at least one eligible session, got ${sessions.length}`)
  const session = sessions[0]
  assert.equal(session.sessionId, 'ses_abcd1234')
  assert.equal(session.title, 'kimi fixture session')
  assert.equal(session.firstSeen, '2026-11-08T09:00:00.000Z', 'firstSeen must come from state.createdAt')
  assert.equal(session.lastSeen, '2026-11-08T09:00:05.000Z', 'lastSeen must come from state.updatedAt')
  await rm(home, { recursive: true, force: true })
})

test('a wire.jsonl session is read as an eligible session, not an empty result', async () => {
  const { home, sessions, roots } = await discover()
  assert.ok(roots.some((root) => root.exists === true), 'fixture session root must be discovered')
  assert.ok(sessions.length >= 1, `expected at least one eligible session, got ${sessions.length}`)
  assert.equal(sessions[0].sessionId, 'ses_abcd1234')
  await rm(home, { recursive: true, force: true })
})
