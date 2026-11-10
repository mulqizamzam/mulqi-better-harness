#!/usr/bin/env node
/**
 * Self-audit: public-clone environment detection for the vendor-integrity gate.
 *
 * A "recognised public-clone environment" is the ONLY place where the
 * integrity suite may skip itself when the audit manifest is absent:
 *
 *   1. the checkout has no .git of its own (npm install / plain copy) — the
 *      private manifest is intentionally not shipped, so it can never exist;
 *   2. the checkout is a clone of the PUBLIC repository and carries no
 *      private workspace material (no work/ source-clone dir, no private
 *      audit files beyond the committed manifest).
 *
 * Everything else is treated as the working folder, where a missing
 * manifest MUST fail the suite instead of skipping it. CI is never a
 * recognised skip environment: the CI workflow materialises the manifest
 * before the test suite runs, so a missing manifest there means the
 * materialise step was dropped — that is a failure, not a documented skip.
 *
 * The detector is pure (fs + a local `git` sub-process with no upward
 * .git search) so the test suite and the execution guard always agree.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

/** Public remotes that count as "a clone of the public repository". */
export const PUBLIC_ORIGIN_PATTERNS = [
  /^https?:\/\/github\.com\/mulqizamzam\/mulqi-better-harness(\.git)?$/i,
  /^git@github\.com:mulqizamzam\/mulqi-better-harness(\.git)?$/i,
]

function gitOrigin(root) {
  try {
    return execFileSync('git', ['-C', root, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim()
  } catch {
    return null
  }
}

/**
 * True when the checkout carries private workspace material, i.e. it is the
 * owner's working folder: a work/ source-clone dir, or audit/ files beyond
 * the committed gate manifest.
 */
export function hasPrivateWorkspace(root) {
  if (existsSync(path.join(root, 'work'))) return true
  const auditDir = path.join(root, 'audit')
  if (existsSync(auditDir)) {
    for (const entry of readdirSync(auditDir)) {
      if (entry !== 'vendor-inventory.sha256') return true
    }
  }
  return false
}

/**
 * Detect whether `root` is a recognised public-clone environment.
 *
 * @param {string} root plugin root directory
 * @param {NodeJS.ProcessEnv} [env] process environment (overridable for tests)
 * @returns {{ publicClone: boolean, reasons: string[] }}
 */
export function detectPublicClone(root, env = process.env) {
  const ci = env.CI === 'true' || env.GITHUB_ACTIONS === 'true'
  if (ci) {
    return {
      publicClone: false,
      reasons: ['CI environment: the gate must execute there (the CI materialise step provides the manifest)'],
    }
  }

  // No .git of its own. Deliberately no upward search: an npm install inside
  // some other user's repository must still count as a public environment.
  if (!existsSync(path.join(root, '.git'))) {
    return {
      publicClone: true,
      reasons: ['no .git of its own (installed or copied package); the private audit manifest is not shipped'],
    }
  }

  const origin = gitOrigin(root)
  const isPublicOrigin = origin !== null && PUBLIC_ORIGIN_PATTERNS.some((re) => re.test(origin))
  const privateMaterial = hasPrivateWorkspace(root)

  if (isPublicOrigin && !privateMaterial) {
    return {
      publicClone: true,
      reasons: ['git clone of the public repository with no private workspace material'],
    }
  }

  const reasons = []
  if (privateMaterial) {
    reasons.push('private workspace material present (work/ or private audit files) — this is the working folder')
  }
  if (origin === null) {
    reasons.push('git checkout without an origin remote')
  } else if (!isPublicOrigin) {
    reasons.push(`origin is not the public repository (${origin})`)
  }
  return { publicClone: false, reasons }
}
