/**
 * Mulqi Better Harness — WORKBUDDY session-adapter discovery gate.
 *
 * Pins the on-disk artifact shape the WorkBuddy host writes: session
 * transcripts <sessionId>.jsonl living directly under the slug-keyed project
 * dir <home>/projects/<workspace-slug>/ (slug = the workspace path with one
 * leading separator stripped and every "/" "\" ":" replaced by "-"), whose
 * records carry a sessionId, a workspace-matching cwd, and epoch-millisecond
 * timestamps. An adapter that misses the slug directory name or the record
 * shape (sessionId + cwd) silently yields zero sessions and no diagnostic.
 *
 * GREEN: the fixture layout yields an eligible session with the exact id.
 */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { WorkbuddySessionAnalyzer } from '../scripts/session-analysis/platforms/workbuddy.mjs'

const FIXTURES = path.resolve(fileURLToPath(new URL('./fixtures/session-analysis/workbuddy/', import.meta.url)))
// Stable fixture workspace; its slug home-fixture-workbuddy-ws1 is the
// project directory name the host writes and the records' cwd.
const WORKSPACE = '/home/fixture-workbuddy/ws1'
const PROJECT_SLUG = 'home-fixture-workbuddy-ws1'
const SESSION_ID = 'wb-sess-0001'

test('a <sessionId>.jsonl transcript in the slug-keyed project dir is read as an eligible session, not an empty result', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'workbuddy-bh-adapter-'))
  const projectDir = path.join(home, 'projects', PROJECT_SLUG)
  await mkdir(projectDir, { recursive: true })
  await writeFile(path.join(projectDir, `${SESSION_ID}.jsonl`), await readFile(path.join(FIXTURES, `${SESSION_ID}.jsonl`)))

  const analyzer = new WorkbuddySessionAnalyzer()
  const scope = await analyzer.resolveScope({ home, workspace: WORKSPACE })
  const roots = await analyzer.discoverSourceRoots(scope)
  const sessions = await analyzer.discoverSessions(scope, roots)
  assert.ok(roots.some((root) => root.exists === true), 'fixture project dir must be discovered')
  assert.ok(sessions.length >= 1, `expected at least one eligible session, got ${sessions.length}`)
  const session = sessions[0]
  assert.equal(session.sessionId, SESSION_ID)
  // The transcript cwd is what makes the probe a workspace match; pin it.
  assert.equal(session.workspace, WORKSPACE)
  assert.equal(session.firstSeen, '2026-11-08T09:00:00.000Z', 'firstSeen must come from the epoch-millisecond records')
  await rm(home, { recursive: true, force: true })
})
