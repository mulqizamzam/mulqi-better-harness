/**
 * Mulqi Better Harness — registration suite.
 *
 * Proves that apply() performs exactly the three registrations the bundle
 * promises (skill provider, skill-tool guard, pre-step gate) and that the
 * disposer unwinds them in reverse order.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test } from 'node:test'

import { apply, inject, name, PACKAGED_ROOT } from '../index.js'
import { PROVIDER_NAME } from '../lib/provider.js'

function mockContext() {
  const order = []
  const calls = { providers: [], guards: [], gates: [] }
  const ctx = {
    skills: {
      registerProvider(factory) {
        calls.providers.push(factory)
        order.push('provider')
        return () => order.push('dispose:provider')
      },
    },
    tools: {
      guard(g) {
        calls.guards.push(g)
        order.push('guard')
        return () => order.push('dispose:guard')
      },
    },
    on(event, handler) {
      calls.gates.push({ event, handler })
      order.push('gate')
      return () => order.push('dispose:gate')
    },
    logger: { info: () => {}, warn: () => {} },
  }
  return { ctx, calls, order }
}

test('the bundle declares the expected entry identity and injected services', () => {
  assert.equal(name, 'mulqi-better-harness')
  assert.deepEqual(inject, ['skills', 'tools'])
  // The packaged root must resolve inside this package, wherever it is cloned.
  assert.ok(PACKAGED_ROOT.endsWith('mulqi-better-harness') || existsSync(`${PACKAGED_ROOT}/index.js`),
    'PACKAGED_ROOT must resolve to the package directory')
  assert.equal(typeof PACKAGED_ROOT, 'string')
})

test('apply registers exactly one provider, one guard, and one pre-step gate', () => {
  const { ctx, calls, order } = mockContext()
  const dispose = apply(ctx)
  assert.equal(typeof dispose, 'function')
  assert.equal(calls.providers.length, 1, 'one skill provider')
  assert.equal(calls.guards.length, 1, 'one tool guard')
  assert.equal(calls.gates.length, 1, 'one event gate')
  assert.equal(calls.gates[0].event, 'agent/pre-step')
  assert.deepEqual(order, ['provider', 'guard', 'gate'])
  dispose()
  assert.deepEqual(order, ['provider', 'guard', 'gate', 'dispose:gate', 'dispose:guard', 'dispose:provider'], 'disposal runs in reverse order')
})

test('the provider factory returns the bundled provider under a live control', () => {
  const { ctx, calls } = mockContext()
  apply(ctx)
  const control = { signal: new AbortController().signal, invalidate: () => {} }
  const provider = calls.providers[0](control)
  assert.equal(provider.name, PROVIDER_NAME)
  assert.equal(typeof provider.list, 'function')
  assert.equal(typeof provider.get, 'function')
})

test('apply fails fast when the canonical skill file is absent', () => {
  const dir = mkdtempSync(`${tmpdir()}/mulqi-bh-root-`)
  try {
    const { ctx } = mockContext()
    assert.throws(
      () => apply(ctx, { mulqiBetterHarnessRoot: dir }),
      (error) => error.message.includes('does not exist') || error.message.includes('cannot be resolved'),
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the tool guard wired by apply is the explicit-only guard', () => {
  const { ctx, calls } = mockContext()
  apply(ctx)
  assert.equal(calls.guards[0]({ name: 'skill', arguments: { name: 'better-harness' } }), 'Mulqi Better Harness requires an explicit /better-harness gesture written by the user.')
  assert.equal(calls.guards[0]({ name: 'read', arguments: {} }), undefined)
})
