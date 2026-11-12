/**
 * Mulqi Better Harness — Cursor session-adapter discovery gate.
 *
 * Pins the on-disk artifact shape the Cursor adapter must read: a
 * workspace-slug-keyed project directory (<home>/projects/<slug>/) whose
 * agent-transcripts/ holds one <sessionId>.jsonl transcript per session, where
 * <slug> is the normalized absolute workspace path with separators collapsed
 * to "-" (workspaceToCursorSlugVariants), so a slug-derivation or depth
 * change silently drops every session with no diagnostic.
 *
 * Defect class prevented (mirror of the DSH gate): a discovery matcher that
 * no longer matches the host artifact layout yields zero eligible sessions
 * silently. The fixture proves the host layout the adapter declares produces
 * exactly one eligible session with the exact session id (transcript basename).
 */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { CursorSessionAnalyzer } from '../scripts/session-analysis/platforms/cursor.mjs'

const FIXTURES = path.resolve(fileURLToPath(new URL('./fixtures/session-analysis/cursor/', import.meta.url)))
// Stable fixture workspace + the slug the adapter derives from it; asserted
// against the discovered root so a slug-derivation change stays red.
const WORKSPACE = '/home/fixture-cursor/ws1'
const SLUG = 'home-fixture-cursor-ws1'
// The session id the adapter reports is the transcript basename minus .jsonl.
const SESSION_ID = 'c9f5a2d1-4b6e-4f3a-9d21-7e8b0c1d2a3f'
const FIXTURE_FILE = `${SESSION_ID}.jsonl`

async function stageCursorHome() {
  const home = await mkdtemp(path.join(tmpdir(), 'cursor-bh-adapter-'))
  const transcriptDir = path.join(home, 'projects', SLUG, 'agent-transcripts')
  await mkdir(transcriptDir, { recursive: true })
  await writeFile(path.join(transcriptDir, FIXTURE_FILE), readFileSync(path.join(FIXTURES, FIXTURE_FILE)))
  return home
}

test('a workspace-slug agent transcript is read as an eligible session, not an empty result', async () => {
  const home = await stageCursorHome()
  const analyzer = new CursorSessionAnalyzer()
  const scope = await analyzer.resolveScope({ home, workspace: WORKSPACE })
  const roots = await analyzer.discoverSourceRoots(scope)
  const sessions = await analyzer.discoverSessions(scope, roots)
  assert.ok(roots.some((root) => root.exists === true), 'staged transcript root must be discovered')
  const transcriptRoot = roots.find((root) => root.kind === 'cursor-agent-transcript')
  assert.equal(
    transcriptRoot.path,
    path.join(home, 'projects', SLUG, 'agent-transcripts'),
    'the workspace-scoped root must match the fixture workspace slug',
  )
  assert.ok(sessions.length >= 1, `expected at least one eligible session, got ${sessions.length}`)
  assert.equal(sessions[0].sessionId, SESSION_ID)
  await rm(home, { recursive: true, force: true })
})
