/**
 * Mulqi Better Harness — Grok session-adapter discovery gate.
 *
 * Pins the on-disk artifact shape the Grok adapter must read: sessions live
 * under <home>/sessions/<encodeURIComponent(cwd)>/<sessionId>/ with
 * summary.json (info.cwd + created_at/updated_at) as the qualifying
 * metadata and updates.jsonl as the authoritative ACP-shaped transcript. The
 * encoded-cwd group name is derived from the workspace string, so a
 * group-naming change silently drops every session with no diagnostic.
 *
 * Defect class prevented (mirror of the DSH gate): a group-name or
 * per-file layout mismatch yields zero eligible sessions silently. The
 * fixture proves the host layout produces exactly one eligible session with
 * the exact session id (the session directory name).
 */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { GrokSessionAnalyzer } from '../scripts/session-analysis/platforms/grok.mjs'

const FIXTURES = path.resolve(fileURLToPath(new URL('./fixtures/session-analysis/grok/', import.meta.url)))
// Stable fixture workspace + the encoded-cwd group name the adapter derives
// from it, and the stable session id (the session directory name).
const WORKSPACE = '/home/fixture-grok/ws1'
const GROUP_NAME = encodeURIComponent(WORKSPACE) // "%2Fhome%2Ffixture-grok%2Fws1"
const SESSION_ID = '7c9d2e1a-4f6b-4a3c-8d5e-2f1a0b9c8d7e'

function stageGrokSession(home, { withUpdates }) {
  const sessionDir = path.join(home, 'sessions', GROUP_NAME, SESSION_ID)
  return (async () => {
    await mkdir(sessionDir, { recursive: true })
    await writeFile(path.join(sessionDir, 'summary.json'), readFileSync(path.join(FIXTURES, 'summary.json')))
    if (withUpdates) {
      await writeFile(path.join(sessionDir, 'updates.jsonl'), readFileSync(path.join(FIXTURES, 'updates.jsonl')))
    }
  })()
}

async function discover(withUpdates) {
  const home = await mkdtemp(path.join(tmpdir(), 'grok-bh-adapter-'))
  await stageGrokSession(home, { withUpdates })
  const analyzer = new GrokSessionAnalyzer()
  const scope = await analyzer.resolveScope({ home, workspace: WORKSPACE })
  const roots = await analyzer.discoverSourceRoots(scope)
  const sessions = await analyzer.discoverSessions(scope, roots)
  return { home, roots, sessions }
}

test('a summary.json-only group session stays eligible (metadata-only coverage)', async () => {
  const { home, roots, sessions } = await discover(false)
  assert.ok(roots.some((root) => root.exists === true), 'staged encoded-cwd group must be discovered')
  assert.equal(
    roots[0].path,
    path.join(home, 'sessions', GROUP_NAME),
    'the workspace-scoped root must match the fixture encoded-cwd group',
  )
  assert.ok(sessions.length >= 1, `expected at least one eligible session, got ${sessions.length}`)
  assert.equal(sessions[0].sessionId, SESSION_ID)
  assert.ok(sessions[0].sourceKinds.includes('grok-summary-json'), 'a summary-only session must keep its summary evidence')
  await rm(home, { recursive: true, force: true })
})

test('a summary.json + updates.jsonl group session is read as an eligible session', async () => {
  const { home, roots, sessions } = await discover(true)
  assert.ok(roots.some((root) => root.exists === true), 'staged encoded-cwd group must be discovered')
  assert.equal(
    roots[0].path,
    path.join(home, 'sessions', GROUP_NAME),
    'the workspace-scoped root must match the fixture encoded-cwd group',
  )
  assert.ok(sessions.length >= 1, `expected at least one eligible session, got ${sessions.length}`)
  assert.equal(sessions[0].sessionId, SESSION_ID)
  assert.ok(
    sessions[0].sourceKinds.includes('grok-updates-jsonl'),
    'the authoritative updates.jsonl transcript must be attached, not the summary fallback',
  )
  assert.equal(sessions[0].workspace, WORKSPACE)
  await rm(home, { recursive: true, force: true })
})
