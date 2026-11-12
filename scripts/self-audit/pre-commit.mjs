#!/usr/bin/env node
/**
 * Self-audit: pre-commit helper that keeps the vendor-integrity manifest
 * in lockstep with the working tree.
 *
 * Install as .git/hooks/pre-commit with one line:
 *   exec node "$(git rev-parse --show-toplevel)/scripts/self-audit/pre-commit.mjs"
 *
 * Behaviour:
 *   - no staged path touches a vendored root (skills, scripts, references,
 *     models, templates) or LICENSE -> silent pass;
 *   - otherwise: regenerate audit/vendor-inventory.sha256 via
 *     regen-manifest.mjs and re-stage the refreshed manifest, so the tree,
 *     the manifest, and the commit always travel together;
 *   - a regeneration failure (missing vendored root, missing manifest)
 *     blocks the commit with regen-manifest's own repair hint.
 *
 * The hook never rewrites tracked content on its own: it only re-stages
 * the manifest after a successful regeneration.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST_REL = path.join('audit', 'vendor-inventory.sha256');
// Mirrors VENDOR_ROOTS + LICENSE in regen-manifest.mjs / materialize-manifest.mjs.
const VENDOR_PREFIXES = ['skills/', 'scripts/', 'references/', 'models/', 'templates/', 'LICENSE'];

function fail(message) {
  console.error(`[pre-commit] FAIL: ${message}`);
  console.error('[pre-commit] repair: fix the failure above, or `git commit --no-verify` to bypass (the gate stays stale).');
  process.exit(1);
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

const staged = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
const stagedPaths = staged ? staged.split('\n').filter(Boolean) : [];
const vendorTouches = stagedPaths.filter((p) => VENDOR_PREFIXES.some((prefix) => p === prefix || p.startsWith(prefix)));
if (vendorTouches.length === 0) process.exit(0);
if (!existsSync(path.join(ROOT, MANIFEST_REL))) {
  fail(`the audit manifest ${MANIFEST_REL} is missing before a vendor-touching commit; run node scripts/self-audit/regen-manifest.mjs first`);
}

const regen = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'self-audit', 'regen-manifest.mjs')], {
  cwd: ROOT,
  stdio: 'inherit',
});
if (regen.status !== 0) {
  fail(`regen-manifest exited ${regen.status} — the commit is blocked until the manifest can be refreshed`);
}

// Re-stage the manifest only when the refresh actually changed it.
if (git(['status', '--porcelain', '--', MANIFEST_REL])) {
  execFileSync('git', ['add', '--', MANIFEST_REL], { cwd: ROOT, encoding: 'utf8' });
}
console.log(`[pre-commit] OK: ${vendorTouches.length} staged path(s) touch a vendored root — vendor manifest kept in lockstep`);
