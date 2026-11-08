/**
 * Mulqi Better Harness — native DeepSeek Harness bundle.
 *
 * Cordis entry. On apply, one row mounts three registrations into every
 * profile that lists this package in `dsh.profile.bundles`:
 *
 *   1. the bundled `better-harness` skill, published into the global skills
 *      layer at the custom-skill rank and self-located from this module's
 *      own URL — no absolute path to configure or keep current;
 *   2. the explicit-only guard on the `skill` tool, which refuses model
 *      invocations of the bundled skill;
 *   3. the `agent/pre-step` verification gate that, when a user-written
 *      `/better-harness` gesture reaches the host, checks the winning skill
 *      definition against the canonical root before the step proceeds.
 *
 * The root is the package's own directory unless the row carries
 * `config.mulqiBetterHarnessRoot` (absolute path to a different complete
 * root). All registrations are disposed in reverse order on teardown.
 *
 * Node builtins only: the host may load this module without a resolvable
 * dependency tree of its own.
 */

import { existsSync, realpathSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { makeProvider, watchSkillRoot } from './lib/provider.js'
import { canonicalPaths, CONFIG_ROOT_KEY, explicitOnlyGuard, registerPreStep } from './lib/policy.js'

/** Cordis entry id (diagnostic label in host logs). */
export const name = 'mulqi-better-harness'

/** Services required at composition time. */
export const inject = ['skills', 'tools']

/** The package root this entry ships in, canonicalized so symlinks cannot trip verification. */
export const PACKAGED_ROOT = realpathSync(dirname(fileURLToPath(import.meta.url)))

/**
 * Choose the root all registrations bind to.
 *
 * @param {object} [config] row config; `mulqiBetterHarnessRoot` optionally
 *   redirects to another complete root (absolute; `~` and relative rejected).
 * @returns {object} canonical paths from {@link canonicalPaths}.
 */
export function selectRoot(config = {}) {
  const override = config?.[CONFIG_ROOT_KEY]
  const requested = override === undefined || override === null || override === '' ? PACKAGED_ROOT : override
  const base = canonicalPaths(requested)
  if (requested === PACKAGED_ROOT) return base
  try {
    // Canonicalize the operator-supplied root so symlinked layouts still
    // verify against one identity.
    return canonicalPaths(realpathSync(base.root))
  } catch (error) {
    throw new Error(
      `${name}: ${CONFIG_ROOT_KEY} ${JSON.stringify(base.root)} cannot be resolved ` +
        `(${error?.code ?? error?.message}); point it at a complete Better Harness root, ` +
        'or drop the override to use the packaged one.',
    )
  }
}

/**
 * @param {object} ctx host context (`skills`, `tools`, `on`, `logger`).
 * @param {object} [config] row config; see {@link selectRoot}.
 * @returns {() => void} disposer for every registration performed here.
 */
export function apply(ctx, config = {}) {
  const paths = selectRoot(config)
  if (!existsSync(paths.skillFile)) {
    throw new Error(
      `${name}: ${paths.skillFile} does not exist, so the better-harness skill cannot be published. ` +
        'Install the complete package, or point this row\'s ' + CONFIG_ROOT_KEY + ' at one.',
    )
  }

  const disposers = []

  disposers.push(
    ctx.skills.registerProvider((control) => {
      watchSkillRoot(control, paths, ctx.logger)
      return makeProvider(paths, { logger: ctx.logger })
    }),
  )

  disposers.push(ctx.tools.guard(explicitOnlyGuard))

  disposers.push(registerPreStep(ctx, paths, ctx.logger))

  if (typeof ctx.logger?.info === 'function') {
    ctx.logger.info(`${name}: published ${paths.skillFile} (global skills layer, custom rank)`)
  }

  return () => {
    for (const dispose of disposers.reverse()) {
      if (typeof dispose === 'function') dispose()
    }
  }
}

export default { name, inject, apply }
