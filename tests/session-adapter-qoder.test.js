/**
 * Mulqi Better Harness — QODER session-adapter discovery gate.
 *
 * Pins the on-disk artifact shape the Qoder host writes per session under the
 * slug-keyed project dir <home>/projects/<workspace-slug>/: the conversation
 * transcript <sessionId>.jsonl (records carry sessionId + timestamp + cwd)
 * next to a <sessionId>/state.json session-state side file (sessionId +
 * createdAt/updatedAt). An adapter that misses either shape (e.g. a slug
 * mismatch on the dir, or dropping the state.json channel) silently loses
 * session evidence with no diagnostic.
 *
 * GREEN: the fixture layout yields an eligible session with the exact id and
 * both source channels reported.
 */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { QoderSessionAnalyzer } from '../scripts/session-analysis/platforms/qoder.mjs'

const FIXTURES = path.resolve(fileURLToPath(new URL('./fixtures/session-analysis/qoder/', import.meta.url)))
// Stable fixture workspace; its slug -home-fixture-qoder-ws1 is the project
// directory name the host writes (Qoder's slugger does NOT strip the leading
// separator of an absolute POSIX path, so the leading "/" becomes "-").
const WORKSPACE = '/home/fixture-qoder/ws1'
const PROJECT_SLUG = '-home-fixture-qoder-ws1'
const SESSION_ID = 'qdr-sess-0001'

async function buildQoderHome() {
  const home = await mkdtemp(path.join(tmpdir(), 'qoder-bh-adapter-'))
  const projectDir = path.join(home, 'projects', PROJECT_SLUG)
  await mkdir(path.join(projectDir, SESSION_ID), { recursive: true })
  await writeFile(path.join(projectDir, `${SESSION_ID}.jsonl`), await readFile(path.join(FIXTURES, `${SESSION_ID}.jsonl`)))
  await writeFile(path.join(projectDir, SESSION_ID, 'state.json'), await readFile(path.join(FIXTURES, 'state.json')))
  return home
}

test('the <sessionId>.jsonl conversation transcript is read as an eligible session, not an empty result', async () => {
  const home = await buildQoderHome()
  const analyzer = new QoderSessionAnalyzer()
  const scope = await analyzer.resolveScope({ home, workspace: WORKSPACE })
  const roots = await analyzer.discoverSourceRoots(scope)
  const sessions = await analyzer.discoverSessions(scope, roots)
  assert.ok(roots.some((root) => root.exists === true), 'fixture project dir must be discovered')
  assert.ok(sessions.length >= 1, `expected at least one eligible session, got ${sessions.length}`)
  const session = sessions[0]
  assert.equal(session.sessionId, SESSION_ID)
  assert.equal(session.coverage.conversation, true, 'the jsonl transcript must be reported as conversation evidence')
  await rm(home, { recursive: true, force: true })
})

test('the <sessionId>/state.json side file is read and reported as session-state coverage', async () => {
  const home = await buildQoderHome()
  const analyzer = new QoderSessionAnalyzer()
  const scope = await analyzer.resolveScope({ home, workspace: WORKSPACE })
  const roots = await analyzer.discoverSourceRoots(scope)
  const sessions = await analyzer.discoverSessions(scope, roots)
  assert.ok(roots.some((root) => root.exists === true), 'fixture project dir must be discovered')
  assert.ok(sessions.length >= 1, `expected at least one eligible session, got ${sessions.length}`)
  const session = sessions[0]
  assert.equal(session.sessionId, SESSION_ID)
  assert.equal(session.coverage.state, true, 'state.json must be reported as session-state evidence')
  assert.equal(session.coverage.conversation, true, 'the jsonl transcript must stay reported alongside state.json')
  // state.json's updatedAt is the newest observed time and must survive into
  // the merged session time range.
  assert.equal(session.lastSeen, '2026-11-08T09:00:05.000Z')
  await rm(home, { recursive: true, force: true })
})
