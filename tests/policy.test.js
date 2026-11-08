/**
 * Mulqi Better Harness — policy suite.
 *
 * Proves the explicit-only guard, the gesture detector, the root
 * validation, and the canonical verification behave exactly as the
 * bundle promises — including every fail-closed branch.
 */

import assert from 'node:assert/strict'
import { lstat } from 'node:fs/promises'
import { test } from 'node:test'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  canonicalPaths,
  containsGesture,
  explicitOnlyGuard,
  inspectLocalPath,
  registerPreStep,
  verifyCanonicalSkill,
} from '../lib/policy.js'
import { PACKAGED_ROOT, selectRoot } from '../index.js'
import { SKILL_NAME } from '../lib/provider.js'

const ROOT = PACKAGED_ROOT
const paths = canonicalPaths(ROOT)

function user(text) {
  return { source: { kind: 'user' }, content: [{ type: 'text', text }] }
}
function model(text) {
  return { source: { kind: 'model' }, content: [{ type: 'text', text }] }
}

test('canonicalPaths accepts the packaged root and rejects unsafe forms', () => {
  assert.equal(canonicalPaths(ROOT).root, ROOT)
  assert.throws(() => canonicalPaths('~/elsewhere'), /literal tilde/)
  assert.throws(() => canonicalPaths('relative/path'), /absolute/)
  assert.throws(() => canonicalPaths(''), /non-empty/)
  assert.throws(() => canonicalPaths(42), /non-empty absolute path/)
})

test('gesture detection only counts user-written /better-harness', () => {
  assert.ok(containsGesture([user('/better-harness please')]))
  assert.ok(containsGesture([user('run /better-harness now')]))
  assert.ok(!containsGesture([model('/better-harness')]), 'model blocks never count')
  assert.ok(!containsGesture([user('/other')]), 'other gestures do not count')
  assert.ok(!containsGesture([user('better-harness without slash')]), 'no slash, no gesture')
  assert.ok(!containsGesture([user('/better-harness-x')]), 'longer tokens do not match')
  assert.ok(!containsGesture([]))
  assert.ok(!containsGesture(undefined))
})

test('the guard refuses model skill invocations and nothing else', () => {
  assert.equal(explicitOnlyGuard({ name: 'skill', arguments: { name: SKILL_NAME } }), 'Mulqi Better Harness requires an explicit /better-harness gesture written by the user.')
  assert.equal(explicitOnlyGuard({ name: 'skill', arguments: { name: 'other-skill' } }), undefined)
  assert.equal(explicitOnlyGuard({ name: 'bash', arguments: { name: SKILL_NAME } }), undefined)
  assert.equal(explicitOnlyGuard({ name: 'skill', arguments: null }), undefined)
  assert.equal(explicitOnlyGuard(undefined), undefined)
})

test('verification passes for a winning candidate against the packaged root', async () => {
  const winner = {
    source: 'custom',
    path: paths.skillFile,
    resourceBase: { kind: 'directory', path: paths.skillDirectory },
    invocation: { modelInvocable: true, userInvocable: true },
  }
  const verdict = await verifyCanonicalSkill({ root: ROOT, skill: winner })
  assert.deepEqual(verdict, { verified: true, reasons: [] }, JSON.stringify(verdict.reasons))
})

test('verification lists every missing winner invariant', async () => {
  const verdict = await verifyCanonicalSkill({ root: ROOT, skill: undefined })
  assert.deepEqual(verdict.reasons, ['skill-not-discovered'])
  assert.equal(verdict.verified, false)

  const wrongSource = {
    source: 'bundled',
    path: paths.skillFile,
    resourceBase: { kind: 'directory', path: paths.skillDirectory },
    invocation: { modelInvocable: true, userInvocable: true },
  }
  assert.deepEqual((await verifyCanonicalSkill({ root: ROOT, skill: wrongSource })).reasons, ['winner-source-mismatch'])

  const wrongInvocation = {
    source: 'custom',
    path: paths.skillFile,
    resourceBase: { kind: 'directory', path: paths.skillDirectory },
    invocation: { modelInvocable: true, userInvocable: false },
  }
  assert.deepEqual((await verifyCanonicalSkill({ root: ROOT, skill: wrongInvocation })).reasons, ['user-invocation-disabled'])
})

test('verification reports missing resources with stable reason keys', async () => {
  const winner = {
    source: 'custom',
    path: paths.skillFile,
    resourceBase: { kind: 'directory', path: paths.skillDirectory },
    invocation: { modelInvocable: true, userInvocable: true },
  }
  const reasons = (await verifyCanonicalSkill({
    root: ROOT,
    skill: winner,
    inspectPath: async (target) => {
      if (target === paths.resourcePaths['references']) return undefined
      return inspectLocalPath(target)
    },
  })).reasons
  assert.deepEqual(reasons, ['required-resource-missing:references'])
})

test('the pre-step gate passes through without a gesture', async () => {
  const calls = []
  const ctx = {
    on(event, handler) {
      calls.push({ event, handler })
      return () => {}
    },
    skills: { get: async () => undefined },
  }
  registerPreStep(ctx, paths)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].event, 'agent/pre-step')
  let nextRan = false
  await calls[0].handler({ agent: {}, messages: [user('hello')], signal: new AbortController().signal }, () => {
    nextRan = true
  })
  assert.ok(nextRan, 'next() called for a gesture-free step')
})

test('the pre-step gate verifies on a gesture and passes through', async () => {
  const seen = {}
  const handlers = []
  const ctx = {
    on(event, handler) {
      handlers.push(handler)
      return () => {}
    },
    skills: {
      get: async (name, options) => {
        seen.name = name
        seen.options = options
        return {
          source: 'custom',
          path: paths.skillFile,
          resourceBase: { kind: 'directory', path: paths.skillDirectory },
          invocation: { modelInvocable: true, userInvocable: true },
        }
      },
    },
  }
  const off = registerPreStep(ctx, paths)
  assert.equal(typeof off, 'function')
  const controller = new AbortController()
  const agent = { session: { header: { cwd: '/tmp' } } }
  let nextRan = false
  await handlers[0]({ agent, messages: [user('/better-harness')], signal: controller.signal }, () => {
    nextRan = true
  })
  assert.equal(seen.name, SKILL_NAME, 'the gate looks up the canonical skill by name')
  assert.equal(seen.options.cwd, '/tmp')
  assert.equal(seen.options.signal, controller.signal)
  assert.equal(seen.options.scope, agent)
  assert.ok(nextRan, 'a verified gesture proceeds to next()')
})

test('the pre-step gate throws a descriptive error when verification fails', async () => {
  const calls = []
  const ctx = {
    on(event, handler) {
      calls.push(handler)
      return () => {}
    },
    skills: { get: async () => undefined },
  }
  registerPreStep(ctx, paths)
  await assert.rejects(
    () => calls[0]({ agent: {}, messages: [user('/better-harness')], signal: new AbortController().signal }, () => {}),
    /verification failed: skill-not-discovered/,
  )
})

test('selectRoot defaults to the packaged root and canonicalizes overrides', () => {
  assert.equal(selectRoot().root, PACKAGED_ROOT)
  assert.equal(selectRoot({ mulqiBetterHarnessRoot: '' }).root, PACKAGED_ROOT)
  assert.throws(() => selectRoot({ mulqiBetterHarnessRoot: '~/x' }), /literal tilde/)
  assert.throws(() => selectRoot({ mulqiBetterHarnessRoot: 'relative' }), /absolute/)
})
