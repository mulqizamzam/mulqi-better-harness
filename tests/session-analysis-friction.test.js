/**
 * Mulqi Better Harness — friction consequence capture at the admission counter.
 *
 * Pins the wiring between the friction taxonomy and concrete consequence
 * tracking: an observed execution failure that is not attributed to a
 * failed check yields the "execution-failure" symptom, and the admission
 * support records friction-kind + affected episode refs + symptom tag.
 * Before the change these candidates carried an empty
 * frictionConsequenceSignals list, so observationCoverage.withFrictionConsequence
 * stayed 0 (dead friction count) while withExecutionFriction reported
 * observed friction.
 *
 * Also pins the execution-friction insights facet consequence capture:
 * friction keySignal rows carry a "consequences" counter and the card
 * finding reports the observed consequence capture.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildTaskEpisodes } from '../scripts/session-analysis/episode-contract.mjs'
import {
  finalizeSessionCoreFacts,
} from '../scripts/session-analysis/episode-facts.mjs'
import { buildInsightPack } from '../scripts/session-analysis/insights.mjs'

const BASE_TIME = Date.parse('2026-07-18T10:00:00.000Z')

function at(seconds) {
  return new Date(BASE_TIME + seconds * 1_000).toISOString()
}

function event({ sessionId = 'session-fixture', taskEpisodeKey = 'task-fixture', timestamp = at(0), type = 'tool', ...rest } = {}) {
  return {
    sessionId,
    taskEpisodeKey,
    timestamp,
    type,
    evidenceRef: { kind: 'fixture', line: 1 },
    ...rest,
  }
}

function buildFacts(events, options = {}) {
  return buildTaskEpisodes(events, {
    includeEpisodeFacts: true,
    platform: 'codex',
    episodeFactLimit: options.limit,
  }).episodeFacts
}

function finalize(episodeFacts, { warnings = [] } = {}) {
  return finalizeSessionCoreFacts({
    scope: {
      platform: 'codex',
      workspaceLabel: 'fixture-workspace',
      until: '2026-07-18T11:00:00.000Z',
    },
    selection: {
      strategy: 'recent',
      eligibleCount: 4,
      selectedCount: 4,
      sampled: false,
    },
    episodeFacts,
    warnings,
  })
}

test('unattributed execution failure captures the execution-failure consequence at the admission counter', () => {
  const facts = buildFacts([
    event({ taskEpisodeKey: 'f1', type: 'user', userText: 'Ship the release build pipeline' }),
    event({ taskEpisodeKey: 'f1', timestamp: at(1), toolName: 'bash', commandText: 'npm run build', success: false }),
  ])
  const entry = facts.entries.find((candidate) => candidate.request.summary.includes('Ship the release build'))
  assert.ok(entry, 'candidate emitted')
  assert.equal(entry.friction?.executionFailures, 1)
  assert.deepEqual(entry.frictionConsequenceSignals, ['execution-failure'])

  const envelope = finalize(facts)
  assert.equal(envelope.observationCoverage.withExecutionFriction, 1)
  assert.equal(envelope.observationCoverage.withFrictionConsequence, 1)
  assert.equal(envelope.populationCoverage.withFrictionConsequence, 1)
  assert.deepEqual(envelope.admissionSupport.frictionConsequences, [
    { kind: 'execution-failure', symptom: 'execution-failure', episodeRefs: ['E1'] },
  ])
})

test('failed check keeps the failed-check symptom and maps to the validation-failure kind', () => {
  const facts = buildFacts([
    event({ taskEpisodeKey: 'f2', type: 'user', userText: 'Fix the parser and run the test suite' }),
    event({ taskEpisodeKey: 'f2', timestamp: at(1), toolName: 'Edit', filePath: 'src/parser.js' }),
    event({ taskEpisodeKey: 'f2', timestamp: at(2), toolName: 'bash', commandText: 'npm test', success: false, relevance: 'relevant' }),
  ])
  const entry = facts.entries.find((candidate) => candidate.request.summary.includes('Fix the parser'))
  assert.ok(entry, 'candidate emitted')
  assert.deepEqual(entry.frictionConsequenceSignals, ['failed-check'])

  const envelope = finalize(facts)
  assert.deepEqual(envelope.admissionSupport.frictionConsequences, [
    { kind: 'validation-failure', symptom: 'failed-check', episodeRefs: ['E1'] },
  ])
})

test('shared execution friction keeps sharedFrictionConsequences and records both episode refs', () => {
  const facts = buildFacts([
    event({ taskEpisodeKey: 'f3a', type: 'user', userText: 'Run the deploy dry run' }),
    event({ taskEpisodeKey: 'f3a', timestamp: at(1), toolName: 'bash', commandText: 'npm run deploy:dry-run', success: false }),
    event({ taskEpisodeKey: 'f3b', type: 'user', userText: 'Run the staging deploy check' }),
    event({ taskEpisodeKey: 'f3b', timestamp: at(2), toolName: 'bash', commandText: 'npm run staging:check', success: false }),
  ])
  const envelope = finalize(facts)
  assert.equal(envelope.observationCoverage.withFrictionConsequence, 2)
  assert.deepEqual(envelope.admissionSupport.sharedFrictionConsequences, [
    { signal: 'execution-failure', episodeRefs: ['E1', 'E2'] },
  ])
  assert.deepEqual(envelope.admissionSupport.frictionConsequences, [
    { kind: 'execution-failure', symptom: 'execution-failure', episodeRefs: ['E1', 'E2'] },
  ])
})

test('execution-friction insights facet carries non-zero consequence capture', () => {
  const pack = buildInsightPack({
    scope: { platform: 'codex', workspace: 'fixture-workspace' },
    events: [
      event({ taskEpisodeKey: 'f4', type: 'user', userText: 'Ship the build pipeline' }),
      event({ taskEpisodeKey: 'f4', timestamp: at(1), toolName: 'bash', commandText: 'npm run build', success: false, evidenceRef: { kind: 'fixture', line: 2 } }),
      event({ taskEpisodeKey: 'f4', timestamp: at(2), toolName: 'bash', commandText: 'npm run build --retry', level: 'warn', evidenceRef: { kind: 'fixture', line: 3 } }),
      event({ taskEpisodeKey: 'f4', timestamp: at(3), toolName: 'bash', commandText: 'npm run build --dry-run', success: true, summary: 'failed dry-run detected earlier', evidenceRef: { kind: 'fixture', line: 4 } }),
    ],
  })
  const friction = pack.keySignals.friction
  const top = friction.find((row) => row.name === 'failed-event')
  assert.ok(top, 'failed-event friction row emitted')
  assert.equal(top.count, 3)
  assert.equal(top.consequences, 2)

  const card = pack.cards.find((item) => item.id === 'execution-friction')
  assert.ok(card, 'execution-friction card emitted')
  assert.equal(card.finding, 'Observed friction category: failed-event (3), 2 observed consequence(s).')
})
