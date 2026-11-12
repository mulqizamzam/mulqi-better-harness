/**
 * Mulqi Better Harness — canonical post-edit verification step.
 *
 * Pins the session-core-facts relation vocabulary for the canonical
 * post-edit verification step: a check that runs after the episode's final
 * change takes the canonical relation "after-final-change". Whether the
 * check is a reviewed, relevant check is carried by the companion
 * "reviewed" flag on the emitted check (and by the
 * observationCoverage.withReviewedRelevantCheck tracker), not by a
 * relation variant.
 *
 * RED before the change (candidates showed "reviewed-relevant-after-change"
 * / "after-final-change-unreviewed"); GREEN after the canonical relation.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildTaskEpisodes } from '../scripts/session-analysis/episode-contract.mjs'
import {
  EPISODE_FACTS_SCHEMA_VERSION,
  SESSION_CORE_FACTS_SCHEMA_VERSION,
  finalizeSessionCoreFacts,
} from '../scripts/session-analysis/episode-facts.mjs'

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

test('canonical schema versions for the post-edit verification step', () => {
  assert.equal(SESSION_CORE_FACTS_SCHEMA_VERSION, 5)
  assert.equal(EPISODE_FACTS_SCHEMA_VERSION, 4)
})

test('check after the final change takes the canonical after-final-change relation with the reviewed flag', () => {
  const facts = buildFacts([
    event({ taskEpisodeKey: 'a', type: 'user', userText: 'Fix the parser and run the test suite' }),
    event({ taskEpisodeKey: 'a', timestamp: at(1), toolName: 'Edit', filePath: 'src/parser.js' }),
    event({ taskEpisodeKey: 'a', timestamp: at(2), toolName: 'bash', commandText: 'npm test', success: true, relevance: 'relevant' }),
  ])
  const entry = facts.entries.find((candidate) => candidate.request.summary.includes('Fix the parser'))
  assert.equal(facts.schemaVersion, EPISODE_FACTS_SCHEMA_VERSION)
  assert.ok(entry, 'candidate emitted')
  assert.equal(entry.checks[0].relation, 'after-final-change')
  assert.equal(entry.checks[0].reviewed, true)
  assert.equal(entry.checks[0].status, 'passed')
  assert.equal(entry.closure, 'relevant-check-passed')
  assert.equal(entry.reviewAfterEdits, 1)
  assert.equal('unverifiable' in entry, false)

  const envelope = finalize(facts)
  assert.equal(envelope.schemaVersion, SESSION_CORE_FACTS_SCHEMA_VERSION)
  assert.equal(envelope.observationCoverage.withReviewedRelevantCheck, 1)
  assert.equal(envelope.admission.withReviewAfterEdits, 1)
  assert.equal(envelope.admission.unverifiableCandidates, 0)
  assert.ok(!envelope.diagnosticFlags.includes('no-reviewed-relevant-check-evidence'))
  assert.ok(!envelope.diagnosticFlags.includes('post-edit-validation-blind'))
  const serialized = JSON.stringify(envelope)
  assert.equal(serialized.includes('reviewed-relevant-after-change'), false)
  assert.equal(serialized.includes('after-final-change-unreviewed'), false)
})

test('unreviewed check after the final change keeps the canonical relation without the reviewed flag and stays unverifiable', () => {
  const facts = buildFacts([
    event({ taskEpisodeKey: 'b', type: 'user', userText: 'Tighten the retry loop in the uploader' }),
    event({ taskEpisodeKey: 'b', timestamp: at(1), toolName: 'Edit', filePath: 'src/uploader.js' }),
    event({ taskEpisodeKey: 'b', timestamp: at(2), toolName: 'bash', commandText: 'npm test', success: true }),
  ])
  const entry = facts.entries.find((candidate) => candidate.request.summary.includes('Tighten the retry loop'))
  assert.ok(entry, 'candidate emitted')
  assert.equal(entry.checks[0].relation, 'after-final-change')
  assert.equal('reviewed' in entry.checks[0], false)
  assert.equal(entry.reviewAfterEdits, 0)
  assert.equal(entry.unverifiable, true)

  const envelope = finalize(facts)
  assert.equal(envelope.observationCoverage.withReviewedRelevantCheck, 0)
  assert.equal(envelope.observationCoverage.unverifiableCandidates, 1)
  assert.equal(envelope.admission.unverifiableCandidates, 1)
  assert.ok(envelope.diagnosticFlags.includes('post-edit-validation-blind'))
})

test('check before the final change keeps the not-after-final-change relation', () => {
  const facts = buildFacts([
    event({ taskEpisodeKey: 'c', type: 'user', userText: 'Rework the exporter then patch the config' }),
    event({ taskEpisodeKey: 'c', timestamp: at(1), toolName: 'bash', commandText: 'npm test', success: true, relevance: 'relevant' }),
    event({ taskEpisodeKey: 'c', timestamp: at(2), toolName: 'Edit', filePath: 'config/exporter.json' }),
  ])
  const entry = facts.entries.find((candidate) => candidate.request.summary.includes('Rework the exporter'))
  assert.ok(entry, 'candidate emitted')
  assert.equal(entry.checks[0].relation, 'not-after-final-change')
  assert.equal('reviewed' in entry.checks[0], false)
})

test('check without any change context keeps the no-change-context relation', () => {
  const facts = buildFacts([
    event({ taskEpisodeKey: 'd', type: 'user', userText: 'Run the flaky queue test and report' }),
    event({ taskEpisodeKey: 'd', timestamp: at(1), toolName: 'bash', commandText: 'npm test', success: true, relevance: 'relevant' }),
  ])
  const entry = facts.entries.find((candidate) => candidate.request.summary.includes('Run the flaky queue test'))
  assert.ok(entry, 'candidate emitted')
  assert.equal(entry.checks[0].relation, 'no-change-context')
  assert.equal('reviewed' in entry.checks[0], false)
})

test('mixed portfolio keeps the withReviewedRelevantCheck tracker visible across candidates', () => {
  const facts = buildFacts([
    event({ taskEpisodeKey: 'a', type: 'user', userText: 'Fix the parser and run the test suite' }),
    event({ taskEpisodeKey: 'a', timestamp: at(1), toolName: 'Edit', filePath: 'src/parser.js' }),
    event({ taskEpisodeKey: 'a', timestamp: at(2), toolName: 'bash', commandText: 'npm test', success: true, relevance: 'relevant' }),
    event({ taskEpisodeKey: 'b', type: 'user', userText: 'Tighten the retry loop in the uploader' }),
    event({ taskEpisodeKey: 'b', timestamp: at(3), toolName: 'Edit', filePath: 'src/uploader.js' }),
    event({ taskEpisodeKey: 'b', timestamp: at(4), toolName: 'bash', commandText: 'npm test', success: true }),
  ])
  const envelope = finalize(facts)
  assert.equal(envelope.observationCoverage.withReviewedRelevantCheck, 1)
  assert.equal(envelope.admission.withReviewAfterEdits, 1)
  assert.equal(envelope.admission.unverifiableCandidates, 1)
  const relations = envelope.candidates.flatMap((candidate) => candidate.checks.map((check) => check.relation)).sort()
  assert.deepEqual(relations, ['after-final-change', 'after-final-change'])
})
