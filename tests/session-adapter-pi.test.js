/**
 * Mulqi Better Harness — Pi session-adapter discovery gate.
 *
 * Pins the on-disk artifact shape the Pi adapter must read: a cwd-slug session
 * directory (<home>/sessions/--<cwd-slug>--/, slug = absolute workspace path
 * with one leading separator stripped and "/" "\\" ":" collapsed to "-")
 * holding one <timestamp>_<sessionId>.jsonl per session. The first record must
 * be the session header (type: "session" with string id + workspace cwd); the
 * header's version field is recorded in event summaries but never gated on,
 * so the sidecar carries no version and the contract's supportedVersions is
 * null.
 *
 * Defect class prevented (mirror of the DSH gate): a slug-derivation or
 * header-requirement change that no longer matches the host layout silently
 * yields zero eligible sessions with no diagnostic.
 */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { PiSessionAnalyzer } from '../scripts/session-analysis/platforms/pi.mjs'

const FIXTURES = path.resolve(fileURLToPath(new URL('./fixtures/session-analysis/pi/', import.meta.url)))
// Stable fixture workspace + the cwd-slug directory the adapter derives from
// it (workspaceToPiSessionDirVariants).exact), and the stable session id
// carried by the header record and the file name's underscore-suffix.
const WORKSPACE = '/home/fixture-pi/ws1'
const SLUG_DIR = '--home-fixture-pi-ws1--'
const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000'
const FIXTURE_FILE = `2026-07-01T10-15-00_${SESSION_ID}.jsonl`

function fixtureHeader() {
  const first = readFileSync(path.join(FIXTURES, FIXTURE_FILE), 'utf8').split('\n')[0]
  return JSON.parse(first)
}

async function discover() {
  // PI_CODING_AGENT_SESSION_DIR would flip the adapter into custom
  // session-dir mode and break the default-tree layout this gate pins; keep
  // the gate hermetic for the duration of the test.
  const saved = process.env.PI_CODING_AGENT_SESSION_DIR
  delete process.env.PI_CODING_AGENT_SESSION_DIR
  try {
    const home = await mkdtemp(path.join(tmpdir(), 'pi-bh-adapter-'))
    const sessionDir = path.join(home, 'sessions', SLUG_DIR)
    await mkdir(sessionDir, { recursive: true })
    await writeFile(path.join(sessionDir, FIXTURE_FILE), readFileSync(path.join(FIXTURES, FIXTURE_FILE)))
    const analyzer = new PiSessionAnalyzer()
    const scope = await analyzer.resolveScope({ home, workspace: WORKSPACE })
    const roots = await analyzer.discoverSourceRoots(scope)
    const sessions = await analyzer.discoverSessions(scope, roots)
    return { home, roots, sessions }
  } finally {
    if (saved === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR
    else process.env.PI_CODING_AGENT_SESSION_DIR = saved
  }
}

test('a cwd-slug session jsonl with a valid header is read as an eligible session', async () => {
  const { home, roots, sessions } = await discover()
  assert.ok(roots.some((root) => root.exists === true), 'staged cwd-slug session directory must be discovered')
  assert.equal(
    roots[0].path,
    path.join(home, 'sessions', SLUG_DIR),
    'the workspace-scoped root must match the fixture cwd-slug directory',
  )
  assert.ok(sessions.length >= 1, `expected at least one eligible session, got ${sessions.length}`)
  assert.equal(sessions[0].sessionId, fixtureHeader().id)
  assert.equal(sessions[0].sessionId, SESSION_ID)
  await rm(home, { recursive: true, force: true })
})
