/**
 * Mulqi Better Harness — Qwen session-adapter discovery gate.
 *
 * Pins the contract that the Qwen Code session adapter must read the
 * artifacts the host actually writes: chat transcripts under
 * <qwen-runtime-dir>/projects/<sanitizeCwd-slug>/chats/<sessionId>.jsonl,
 * eligible only when a recorded per-line cwd matches the scoped workspace.
 * The project directory is named by the adapter's own
 * workspaceToQwenSlugVariants fold, so this test stages the fixture through
 * that function: drift between the host's directory naming and the adapter's
 * slug matcher (a guessed slug shape, a dropped recorded-cwd gate, or a
 * version-style name gate like the one the DSH adapter once had) silently
 * yields zero sessions with no diagnostic, and this test fails instead.
 */

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  QwenSessionAnalyzer,
  workspaceToQwenSlugVariants,
} from '../scripts/session-analysis/platforms/qwen.mjs'

const FIXTURES = path.resolve(fileURLToPath(new URL('./fixtures/session-analysis/qwen/', import.meta.url)))

const FIXTURE_SESSION_ID = '7c2f5a6e-9b8d-4e12-af34-c5d6e7f80912'
const FIXTURE_WORKSPACE = '/home/fixture-qwen/ws1'

function fixtureSlug() {
  const slugs = workspaceToQwenSlugVariants(FIXTURE_WORKSPACE)
  assert.equal(slugs.length, 1, 'the fixture workspace must fold to a single qwen slug')
  return slugs[0]
}

async function buildQwenHome() {
  const home = await mkdtemp(path.join(tmpdir(), 'qwen-bh-adapter-'))
  const chatsDir = path.join(home, 'projects', fixtureSlug(), 'chats')
  await mkdir(chatsDir, { recursive: true })
  const artifactName = `${FIXTURE_SESSION_ID}.jsonl`
  const bytes = readFileSync(path.join(FIXTURES, artifactName))
  await writeFile(path.join(chatsDir, artifactName), bytes)
  return home
}

async function discover() {
  const home = await buildQwenHome()
  const analyzer = new QwenSessionAnalyzer()
  // runtimeDir is pinned to the staged home so an ambient QWEN_RUNTIME_DIR
  // cannot redirect discovery away from the fixture.
  const scope = await analyzer.resolveScope({ home, runtimeDir: home, workspace: FIXTURE_WORKSPACE })
  const roots = await analyzer.discoverSourceRoots(scope)
  const sessions = await analyzer.discoverSessions(scope, roots)
  return { home, sessions, roots }
}

test('a chat transcript with a recorded workspace cwd is read as an eligible session', async () => {
  const { home, sessions, roots } = await discover()
  assert.ok(roots.some((root) => root.exists === true), 'the staged chats root must be discovered')
  assert.ok(sessions.length >= 1, `expected at least one eligible session, got ${sessions.length}`)
  assert.equal(sessions[0].sessionId, FIXTURE_SESSION_ID)
  await rm(home, { recursive: true, force: true })
})
