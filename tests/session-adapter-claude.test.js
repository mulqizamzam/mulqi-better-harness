/**
 * Mulqi Better Harness — Claude session-adapter discovery gate.
 *
 * Pins the contract that the Claude session adapter must read the artifacts
 * the host actually writes: a project transcript under
 * <claude-home>/projects/<workspace-slug>/<sessionId>.jsonl, eligible only
 * when a recorded per-line cwd matches the scoped workspace. The project
 * directory is named by the adapter's own workspaceToClaudeSlugVariants
 * fold, so this test stages the fixture through that function: drift between
 * the host's directory naming and the adapter's slug matcher (a guessed slug
 * shape, a dropped recorded-cwd gate, or a version-style name gate like the
 * one the DSH adapter once had) silently yields zero sessions with no
 * diagnostic, and this test fails instead.
 */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  ClaudeSessionAnalyzer,
  workspaceToClaudeSlugVariants,
} from '../scripts/session-analysis/platforms/claude.mjs'

const FIXTURES = path.resolve(fileURLToPath(new URL('./fixtures/session-analysis/claude/', import.meta.url)))

const FIXTURE_SESSION_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3369'
const FIXTURE_WORKSPACE = '/home/fixture-claude/ws1'

function fixtureSlug() {
  const slugs = workspaceToClaudeSlugVariants(FIXTURE_WORKSPACE)
  assert.equal(slugs.length, 1, 'the fixture workspace must fold to a single claude slug')
  return slugs[0]
}

async function buildClaudeHome() {
  const home = await mkdtemp(path.join(tmpdir(), 'claude-bh-adapter-'))
  const projectDir = path.join(home, 'projects', fixtureSlug())
  await mkdir(projectDir, { recursive: true })
  const artifactName = `${FIXTURE_SESSION_ID}.jsonl`
  const bytes = readFileSync(path.join(FIXTURES, artifactName))
  await writeFile(path.join(projectDir, artifactName), bytes)
  return home
}

async function discover() {
  const home = await buildClaudeHome()
  const analyzer = new ClaudeSessionAnalyzer()
  const scope = await analyzer.resolveScope({ home, workspace: FIXTURE_WORKSPACE })
  const roots = await analyzer.discoverSourceRoots(scope)
  const sessions = await analyzer.discoverSessions(scope, roots)
  return { home, sessions, roots }
}

test('a project transcript with a recorded workspace cwd is read as an eligible session', async () => {
  const { home, sessions, roots } = await discover()
  assert.ok(roots.some((root) => root.exists === true), 'the staged project transcript root must be discovered')
  assert.ok(sessions.length >= 1, `expected at least one eligible session, got ${sessions.length}`)
  assert.equal(sessions[0].sessionId, FIXTURE_SESSION_ID)
  await rm(home, { recursive: true, force: true })
})
