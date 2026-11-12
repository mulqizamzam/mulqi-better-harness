/**
 * Mulqi Better Harness — HARNESS-RUN session-adapter discovery gate.
 *
 * Pins the on-disk artifact shape the harness-run evidence writer produces:
 * per-trial traces <root>/<variant>/<trial>/trace.jsonl, each gated on the
 * sibling <root>/<variant>/revision.json side file whose revisionId forms the
 * first component of the session id (<revisionId>:<variant>:<trial>). An
 * adapter that misses the trace.jsonl basename match or silently skips a
 * trial without its revision.json loses that harness run's evidence with no
 * diagnostic.
 *
 * GREEN: the fixture layout yields an eligible session with the exact id.
 */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { HarnessRunSessionAnalyzer } from '../scripts/session-analysis/platforms/harness-run.mjs'

const FIXTURES = path.resolve(fileURLToPath(new URL('./fixtures/session-analysis/harness-run/', import.meta.url)))
// Stable fixture workspace, passed to resolveScope for the session's
// workspace scoping (the evidence root itself comes from the home option).
const WORKSPACE = '/home/fixture-harness-run/ws1'
const VARIANT = 'main'
const TRIAL = 'trial-0001'
const SESSION_ID = 'rev-0001:main:trial-0001'

async function buildHarnessRunHome() {
  const home = await mkdtemp(path.join(tmpdir(), 'harness-run-bh-adapter-'))
  await mkdir(path.join(home, VARIANT, TRIAL), { recursive: true })
  // revision.json is the gate: without it the trace is skipped, so a trace
  // test must stage it too — it is part of the host's on-disk shape.
  await writeFile(path.join(home, VARIANT, 'revision.json'), await readFile(path.join(FIXTURES, 'revision.json')))
  await writeFile(path.join(home, VARIANT, TRIAL, 'trace.jsonl'), await readFile(path.join(FIXTURES, 'trace.jsonl')))
  return home
}

test('a trace.jsonl under a trial dir is read as an eligible session, not an empty result', async () => {
  const home = await buildHarnessRunHome()
  const analyzer = new HarnessRunSessionAnalyzer()
  const scope = await analyzer.resolveScope({ home, workspace: WORKSPACE })
  const roots = await analyzer.discoverSourceRoots(scope)
  const sessions = await analyzer.discoverSessions(scope, roots)
  assert.ok(roots.some((root) => root.exists === true), 'fixture evidence root must be discovered')
  assert.ok(sessions.length >= 1, `expected at least one eligible session, got ${sessions.length}`)
  assert.equal(sessions[0].sessionId, SESSION_ID)
  await rm(home, { recursive: true, force: true })
})

test('the revision.json side file supplies the revisionId half of the session id', async () => {
  const home = await buildHarnessRunHome()
  const analyzer = new HarnessRunSessionAnalyzer()
  const scope = await analyzer.resolveScope({ home, workspace: WORKSPACE })
  const roots = await analyzer.discoverSourceRoots(scope)
  const sessions = await analyzer.discoverSessions(scope, roots)
  assert.ok(sessions.length >= 1, `expected at least one eligible session, got ${sessions.length}`)
  const session = sessions[0]
  assert.equal(session.sessionId, SESSION_ID, 'sessionId must be <revisionId>:<variant>:<trial>')
  assert.equal(session.revisionId, 'rev-0001', 'revision.json must be parsed and carried on the session')
  assert.equal(session.workspace, WORKSPACE)
  await rm(home, { recursive: true, force: true })
})
