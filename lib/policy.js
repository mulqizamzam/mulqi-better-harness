/**
 * Mulqi Better Harness — explicit-only policy and canonical verification.
 *
 * Two jobs, one surface:
 *
 *   1. `explicitOnlyGuard` — a `ctx.tools.guard` that refuses model-facing
 *      `skill({ name: "better-harness" })` calls; only a user-written
 *      `/better-harness` gesture may load the body.
 *   2. `registerPreStep` — an `agent/pre-step` gate that, whenever a user
 *      message carries that gesture, verifies the winning skill definition
 *      against the canonical root before the step proceeds. A failing
 *      verification blocks the step; a missing skill blocks it too.
 *
 * Node builtins only.
 */

import { lstat } from 'node:fs/promises'
import { join, isAbsolute, resolve } from 'node:path'

import { SKILL_NAME } from './provider.js'

/** Optional row config key that redirects both jobs to another complete root. */
export const CONFIG_ROOT_KEY = 'mulqiBetterHarnessRoot'

const GESTURE_RE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g

/** Resources the canonical root must carry for the skill to stay verified. */
const REQUIRED_RESOURCES = Object.freeze([
  { relative: 'skills/better-harness', kind: 'directory' },
  { relative: 'skills/better-harness/SKILL.md', kind: 'file' },
  { relative: 'scripts/better-harness.mjs', kind: 'file' },
  { relative: 'references', kind: 'directory' },
  { relative: 'models', kind: 'directory' },
  { relative: 'templates', kind: 'directory' },
])

/**
 * Resolve and validate a root path.
 *
 * @param {string} root operator-supplied root; must be a non-empty absolute
 *   path. A literal `~` and relative paths are rejected — the host does not
 *   expand tildes, and a relative value would drift with the working dir.
 * @returns {{ root, skillDirectory, skillFile, resourcePaths: Record<string,string> }}
 */
export function canonicalPaths(root) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new TypeError('mulqiBetterHarnessRoot must be a non-empty absolute path')
  }
  if (root === '~' || root.startsWith('~/') || root.startsWith('~\\')) {
    throw new Error('mulqiBetterHarnessRoot must be absolute; a literal tilde is not expanded')
  }
  if (!isAbsolute(root)) {
    throw new Error('mulqiBetterHarnessRoot must be an absolute path')
  }
  const resolved = resolve(root)
  const skillDirectory = join(resolved, 'skills', SKILL_NAME)
  return {
    root: resolved,
    skillDirectory,
    skillFile: join(skillDirectory, 'SKILL.md'),
    resourcePaths: Object.freeze(
      Object.fromEntries(REQUIRED_RESOURCES.map((entry) => [entry.relative, join(resolved, entry.relative)])),
    ),
  }
}

/** @returns {Promise<{kind:string, symbolicLink:boolean}|undefined>} */
export async function inspectLocalPath(target) {
  try {
    const info = await lstat(target)
    return {
      kind: info.isFile() ? 'file' : info.isDirectory() ? 'directory' : 'other',
      symbolicLink: info.isSymbolicLink(),
    }
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return undefined
    throw error
  }
}

/** Does this tool execution target the bundled skill from the model side? */
export function isModelSkillInvocation(execution) {
  if (execution?.name !== 'skill') return false
  if (typeof execution.arguments !== 'object' || execution.arguments === null) return false
  return execution.arguments.name === SKILL_NAME
}

/**
 * The `ctx.tools.guard` handler: returns a refusal reason for model-facing
 * invocations of the bundled skill, `undefined` for everything else.
 *
 * @param {object} execution `{ name, arguments }` tool execution input.
 * @returns {string|undefined}
 */
export function explicitOnlyGuard(execution) {
  if (!isModelSkillInvocation(execution)) return undefined
  return `Mulqi Better Harness requires an explicit /${SKILL_NAME} gesture written by the user.`
}

/**
 * Detect the slash-command gesture in user-authored text blocks. Model
 * blocks and user blocks without a text part never count.
 *
 * @param {Array} messages message records with `{ source: { kind }, content: [{ type, text }] }`.
 * @returns {boolean}
 */
export function containsGesture(messages) {
  for (const message of messages ?? []) {
    if (message?.source?.kind !== 'user') continue
    for (const block of message.content ?? []) {
      if (block?.type !== 'text') continue
      for (const match of String(block.text).matchAll(GESTURE_RE)) {
        if (match[2] === SKILL_NAME) return true
      }
    }
  }
  return false
}

/**
 * Verify a discovered skill definition against the canonical root.
 *
 * @param {object} params `{ root, skill, inspectPath?, pathApi? }` — `skill`
 *   is the winning candidate/definition from `ctx.skills.get()`, possibly
 *   `undefined` when discovery found nothing.
 * @returns {Promise<{ verified: boolean, reasons: string[] }>}
 */
export async function verifyCanonicalSkill({ root, skill, inspectPath = inspectLocalPath } = {}) {
  const paths = canonicalPaths(root)
  const reasons = []

  if (skill === undefined) {
    return { verified: false, reasons: ['skill-not-discovered'], paths }
  }
  if (skill.source !== 'custom') reasons.push('winner-source-mismatch')
  if (skill.path !== paths.skillFile) reasons.push('winner-path-mismatch')
  if (skill.resourceBase?.kind !== 'directory' || skill.resourceBase.path !== paths.skillDirectory) {
    reasons.push('resource-base-mismatch')
  }
  const discoveredRoot = skill.resourceBase?.kind === 'directory'
    ? resolve(skill.resourceBase.path, '..', '..')
    : undefined
  if (discoveredRoot !== paths.root) reasons.push('root-invariant-mismatch')
  if (skill.invocation?.userInvocable !== true) reasons.push('user-invocation-disabled')

  for (const required of REQUIRED_RESOURCES) {
    const target = paths.resourcePaths[required.relative]
    const info = await inspectPath(target)
    if (info === undefined || info.kind !== required.kind) {
      reasons.push(`required-resource-missing:${required.relative}`)
    } else if (info.symbolicLink) {
      reasons.push(`symbolic-link-not-supported:${required.relative}`)
    }
  }

  return { verified: reasons.length === 0, reasons }
}

/**
 * Register the `agent/pre-step` verification gate on a host context.
 *
 * The gate runs on every step; it does nothing unless a user message in the
 * step carries the `/better-harness` gesture. When it fires, the winning
 * skill definition is verified against the canonical root and the step is
 * blocked until the verification passes.
 *
 * @param {object} ctx host context with `on`, `skills`, `logger`.
 * @param {object} paths `{ root, skillFile }` from {@link canonicalPaths}.
 * @param {object} [logger] host logger for gate diagnostics.
 * @returns {() => void} the gate disposer.
 */
export function registerPreStep(ctx, paths, logger) {
  const warn = (message) => {
    if (typeof logger?.warn === 'function') logger.warn(`mulqi-better-harness: ${message}`)
  }
  return ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    if (!containsGesture(messages)) return next()
    signal?.throwIfAborted?.()
    const skill = await ctx.skills.get(SKILL_NAME, {
      cwd: agent?.session?.header?.cwd,
      signal,
      scope: agent,
    })
    signal?.throwIfAborted?.()
    const verdict = await verifyCanonicalSkill({ root: paths.root, skill })
    if (!verdict.verified) {
      warn(`gesture blocked (${verdict.reasons.join(', ')})`)
      throw new Error(`mulqi-better-harness: /${SKILL_NAME} verification failed: ${verdict.reasons.join(', ')}`)
    }
    return next()
  })
}
