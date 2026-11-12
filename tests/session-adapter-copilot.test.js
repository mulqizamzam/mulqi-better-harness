/**
 * Mulqi Better Harness — Copilot session-adapter discovery gate.
 *
 * Pins the on-disk artifact shape the Copilot adapter must read: one
 * per-session directory under <home>/session-state/<sessionId>/ carrying
 * events.jsonl (the typed lifecycle transcript) plus a flat workspace.yaml
 * descriptor whose `id:` and `cwd:` keys pin the session identity and the
 * workspace match. The session directory name, the descriptor id, and the
 * session.start record's data.sessionId must all agree.
 *
 * Defect class prevented (mirror of the DSH gate): a discovery walk that no
 * longer accepts the per-session directory layout (or a descriptor-key
 * mismatch) silently yields zero eligible sessions with no diagnostic.
 */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CopilotSessionAnalyzer,
  parseWorkspaceDescriptor,
} from '../scripts/session-analysis/platforms/copilot.mjs'

const FIXTURES = path.resolve(fileURLToPath(new URL('./fixtures/session-analysis/copilot/', import.meta.url)))
// Stable fixture workspace + session id; the descriptor id asserted in the
// test is parsed from the fixture itself so it cannot drift from the file.
const WORKSPACE = '/home/fixture-copilot/ws1'
const SESSION_ID = '3f9a7b2e-1c5d-4e6f-8a9b-0c1d2e3f4a5b'

function fixtureDescriptor() {
  return parseWorkspaceDescriptor(readFileSync(path.join(FIXTURES, 'workspace.yaml'), 'utf8'))
}

async function discover() {
  const home = await mkdtemp(path.join(tmpdir(), 'copilot-bh-adapter-'))
  const sessionDir = path.join(home, 'session-state', fixtureDescriptor().id)
  await mkdir(sessionDir, { recursive: true })
  await writeFile(path.join(sessionDir, 'events.jsonl'), readFileSync(path.join(FIXTURES, 'events.jsonl')))
  await writeFile(path.join(sessionDir, 'workspace.yaml'), readFileSync(path.join(FIXTURES, 'workspace.yaml')))
  const analyzer = new CopilotSessionAnalyzer()
  const scope = await analyzer.resolveScope({ home, workspace: WORKSPACE })
  const roots = await analyzer.discoverSourceRoots(scope)
  const sessions = await analyzer.discoverSessions(scope, roots)
  return { home, roots, sessions }
}

test('a session-state transcript (events.jsonl) is read as an eligible session', async () => {
  const { home, roots, sessions } = await discover()
  assert.ok(roots.some((root) => root.exists === true), 'staged session-state root must be discovered')
  assert.equal(roots[0].path, path.join(home, 'session-state'), 'the declared session-state root must be the fixture home')
  assert.ok(sessions.length >= 1, `expected at least one eligible session, got ${sessions.length}`)
  assert.equal(sessions[0].sessionId, SESSION_ID)
  await rm(home, { recursive: true, force: true })
})

test('the workspace.yaml descriptor pins the session id and the workspace match', async () => {
  const { home, roots, sessions } = await discover()
  const descriptor = fixtureDescriptor()
  assert.equal(descriptor.id, SESSION_ID, 'descriptor id must equal the stable fixture session id')
  assert.equal(descriptor.cwd, WORKSPACE, 'descriptor cwd must equal the fixture workspace')
  assert.ok(roots.some((root) => root.exists === true), 'staged session-state root must be discovered')
  assert.ok(sessions.length >= 1, `expected at least one eligible session, got ${sessions.length}`)
  assert.equal(sessions[0].sessionId, descriptor.id)
  assert.equal(sessions[0].workspace, WORKSPACE)
  assert.equal(sessions[0].sourceRefs[0].cwd, descriptor.cwd, 'the descriptor cwd must bind the session workspace')
  await rm(home, { recursive: true, force: true })
})
