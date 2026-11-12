/**
 * Mulqi Better Harness — DSH session-adapter discovery gate.
 *
 * Pins the contract that the DSH session adapter must read the artifacts the
 * host actually writes: versioned artifact names (session.v<n>.jsonl[.zstd]),
 * a supported format-version range (not an exact-equality gate) that surfaces an
 * explicit unsupported-version diagnostic, and the version-4 header/event schema
 * (isSeeded + the job/system/subagent/workspace pinned replay events).
 *
 * RED before the adapter change (unversioned-only matcher + exact version 0 gate
 * silently yield zero sessions and no diagnostic); GREEN after it.
 */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  DshSessionAnalyzer,
  dshProjectKey,
  encodeDshSessionId,
} from '../scripts/session-analysis/platforms/dsh.mjs'

const FIXTURES = path.resolve(fileURLToPath(new URL('./fixtures/session-analysis/dsh/', import.meta.url)))
// The supported range the adapter now reports to the caller; asserted as the
// explicit, observable contract rather than re-imported so the test stays
// loadable (and red) before the adapter change.
const EXPECTED_SUPPORTED_RANGE = [0, 4]

function fixtureHeader(name) {
  const first = readFileSync(path.join(FIXTURES, name), 'utf8').split('\n')[0]
  return JSON.parse(first)
}

async function buildSessionHome(fixtureName) {
  const header = fixtureHeader(fixtureName)
  const home = await mkdtemp(path.join(tmpdir(), 'dsh-bh-adapter-'))
  const sessionDir = path.join(home, 'sessions', dshProjectKey(header.cwd), encodeDshSessionId(header.id))
  await mkdir(sessionDir, { recursive: true })
  const artifactName = `session.v${header.version}.jsonl`
  const bytes = readFileSync(path.join(FIXTURES, fixtureName))
  await writeFile(path.join(sessionDir, artifactName), bytes)
  return { home, header, artifactName }
}

async function discover(fixtureName) {
  const { home, header } = await buildSessionHome(fixtureName)
  const analyzer = new DshSessionAnalyzer()
  const scope = await analyzer.resolveScope({ home, workspace: header.cwd })
  const roots = await analyzer.discoverSourceRoots(scope)
  const sessions = await analyzer.discoverSessions(scope, roots)
  return { home, sessions, roots }
}

test('a version-4 artifact is read as an eligible session, not an empty result', async () => {
  const { home, sessions, roots } = await discover('v4-header.session.jsonl')
  assert.equal(roots[0].exists, true, 'fixture session root must be discovered')
  assert.ok(sessions.length >= 1, `expected at least one eligible session, got ${sessions.length}`)
  const session = sessions[0]
  assert.equal(session.sessionId, fixtureHeader('v4-header.session.jsonl').id)
  // The version-4 pinned replay events are accepted, not rejected.
  const unsupported = session.diagnostics.knownUnsupportedTypes ?? []
  assert.ok(unsupported.includes('job/registered'), `expected job/registered to be pinned, got ${JSON.stringify(unsupported)}`)
  assert.ok(unsupported.includes('workspace/changes'), `expected workspace/changes to be pinned, got ${JSON.stringify(unsupported)}`)
  await rm(home, { recursive: true, force: true })
})

test('an out-of-range session version is reported, not silently dropped', async () => {
  const { home, sessions, roots } = await discover('unsupported-header.session.jsonl')
  const header = fixtureHeader('unsupported-header.session.jsonl')
  assert.equal(sessions.length, 0, `expected no eligible session for version ${header.version}`)
  const warnings = roots[0].warnings ?? []
  const diag = warnings.find((entry) => entry.code === 'dsh-unsupported-session-version')
  assert.ok(diag, `expected a dsh-unsupported-session-version diagnostic, got ${JSON.stringify(warnings)}`)
  assert.equal(diag.observedVersion, header.version, 'diagnostic must carry the observed version')
  assert.deepEqual(diag.supportedRange, EXPECTED_SUPPORTED_RANGE, 'diagnostic must carry the supported range')
  await rm(home, { recursive: true, force: true })
})
