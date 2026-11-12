#!/usr/bin/env node
/**
 * Self-audit: standalone cross-check of every session-adapter's declared
 * artifact contract against the fixtures pinned on disk.
 *
 * Re-runs the same assertions as tests/session-adapter-registry.test.js —
 * each platform module's frozen PLATFORM_SESSION_ARTIFACT_CONTRACT
 * (accepted artifact-name patterns + supported format-version range, if
 * any) must line up with the sidecar + files under
 * tests/fixtures/session-analysis/<platform>/ — without the node:test
 * framework, so the gate can run from a hook, a push step, or a bare
 * `node scripts/self-audit/adapter-drift-check.mjs` outside the suite.
 *
 * Exit 0: every platform's declared names/versions match the pinned
 * fixtures. Exit 1: at least one drift, printed as
 * `[adapter-drift-check] FAIL <platform>: <reason>` lines.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createAnalyzer, SUPPORTED_SESSION_PROVIDERS } from '../session-analysis/analyzer.mjs';
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as augment } from '../session-analysis/platforms/augment.mjs';
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as claude } from '../session-analysis/platforms/claude.mjs';
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as codex } from '../session-analysis/platforms/codex.mjs';
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as copilot } from '../session-analysis/platforms/copilot.mjs';
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as cursor } from '../session-analysis/platforms/cursor.mjs';
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as dsh } from '../session-analysis/platforms/dsh.mjs';
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as grok } from '../session-analysis/platforms/grok.mjs';
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as harnessRun } from '../session-analysis/platforms/harness-run.mjs';
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as kimi } from '../session-analysis/platforms/kimi.mjs';
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as pi } from '../session-analysis/platforms/pi.mjs';
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as qoder } from '../session-analysis/platforms/qoder.mjs';
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as qwen } from '../session-analysis/platforms/qwen.mjs';
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as workbuddy } from '../session-analysis/platforms/workbuddy.mjs';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTRACTS = Object.freeze({
  augment,
  claude,
  codex,
  copilot,
  cursor,
  dsh,
  grok,
  'harness-run': harnessRun,
  kimi,
  pi,
  qoder,
  qwen,
  workbuddy,
});

const FIXTURES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tests', 'fixtures', 'session-analysis');
const failures = [];

function fail(platform, reason) {
  failures.push(`FAIL ${platform}: ${reason}`);
}

// Registry/contract parity: a registry platform without a declared contract
// (or a contract for a platform the registry does not load) is drift.
if (JSON.stringify([...SUPPORTED_SESSION_PROVIDERS].sort()) !== JSON.stringify(Object.keys(CONTRACTS).sort())) {
  fail('registry', `SUPPORTED_SESSION_PROVIDERS (${SUPPORTED_SESSION_PROVIDERS.join(', ')}) does not match the imported contract set (${Object.keys(CONTRACTS).join(', ')})`);
}

for (const platform of SUPPORTED_SESSION_PROVIDERS) {
  const contract = CONTRACTS[platform];
  if (!contract) continue;

  // Shape: the contract must be frozen and well-formed before fixtures are
  // compared against it.
  if (!Object.isFrozen(contract)) fail(platform, 'the artifact contract is not frozen');
  if (contract.platform !== platform) fail(platform, `the contract names platform "${contract.platform}"`);
  if (!Array.isArray(contract.artifactNames) || contract.artifactNames.length === 0) {
    fail(platform, 'artifactNames must list at least one accepted artifact-name pattern');
  } else {
    for (const pattern of contract.artifactNames) {
      if (!(pattern instanceof RegExp)) fail(platform, `artifactNames entries must be RegExp, got ${String(pattern)}`);
    }
  }
  const versions = contract.supportedVersions;
  const hasRange = Array.isArray(versions) && versions.length === 2 && versions.every((value) => Number.isInteger(value)) && versions[0] <= versions[1];
  if (versions !== null && !hasRange) fail(platform, 'supportedVersions must be null or an integer [min, max] range');

  // Registry wiring: the thunk must load a working analyzer.
  try {
    const analyzer = await createAnalyzer(platform);
    if (typeof analyzer.discoverSessions !== 'function') fail(platform, 'the loaded adapter does not implement discoverSessions');
  } catch (error) {
    fail(platform, `the registry thunk failed to load the adapter: ${error?.message ?? error}`);
    continue;
  }

  // Fixtures on disk vs the sidecar vs the declared contract.
  const dir = path.join(FIXTURES_ROOT, platform);
  if (!existsSync(dir)) {
    fail(platform, `missing fixture directory tests/fixtures/session-analysis/${platform}/`);
    continue;
  }
  const sidecarPath = path.join(dir, 'fixtures.json');
  if (!existsSync(sidecarPath)) {
    fail(platform, `missing sidecar tests/fixtures/session-analysis/${platform}/fixtures.json`);
    continue;
  }
  let sidecar;
  try {
    sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
  } catch (error) {
    fail(platform, `sidecar fixtures.json does not parse: ${error?.message ?? error}`);
    continue;
  }
  if (sidecar.platform !== platform) fail(platform, `the sidecar names platform "${sidecar.platform}"`);
  if (!Array.isArray(sidecar.artifacts) || sidecar.artifacts.length === 0) {
    fail(platform, 'the sidecar must pin at least one fixture');
    continue;
  }

  const onDisk = new Set(readdirSync(dir).filter((name) => name !== 'fixtures.json'));
  const listed = new Set(sidecar.artifacts.map((entry) => entry.file));
  if (JSON.stringify([...onDisk].sort()) !== JSON.stringify([...listed].sort())) {
    fail(platform, 'fixture files on disk and the sidecar entries must agree exactly');
  }

  for (const entry of sidecar.artifacts) {
    const hostName = entry.hostArtifactName ?? entry.file;
    if (!contract.artifactNames.some((pattern) => pattern instanceof RegExp && pattern.test(hostName))) {
      fail(platform, `fixture host artifact "${hostName}" matches no declared artifact-name pattern — declare it in the adapter contract or drop the fixture`);
    }
    if (entry.expected !== 'eligible' && entry.expected !== 'unsupported-version') {
      fail(platform, `fixture ${entry.file}: unexpected disposition ${JSON.stringify(entry.expected)}`);
    }
    if (entry.version !== undefined && versions === null) {
      fail(platform, `fixture ${entry.file} declares version ${entry.version} but the adapter declares no supported-version range`);
    }
    if (hasRange && entry.version !== undefined) {
      const inRange = entry.version >= versions[0] && entry.version <= versions[1];
      if (entry.expected === 'eligible' && !inRange) {
        fail(platform, `eligible fixture ${entry.file} version ${entry.version} is outside the declared range [${versions[0]}, ${versions[1]}]`);
      }
      if (entry.expected === 'unsupported-version' && inRange) {
        fail(platform, `fixture ${entry.file} is marked unsupported-version but ${entry.version} is inside the declared range [${versions[0]}, ${versions[1]}]`);
      }
    }
  }

  const eligible = sidecar.artifacts.filter((entry) => entry.expected === 'eligible');
  if (eligible.length === 0) fail(platform, 'no eligible fixture is pinned');
  if (hasRange && !eligible.some((entry) => entry.version === versions[1])) {
    fail(platform, `no eligible fixture pins the top of the declared supported-version range [${versions[0]}, ${versions[1]}] — a newer host version would drop silently`);
  }
}

if (failures.length > 0) {
  for (const line of failures) console.error(`[adapter-drift-check] ${line}`);
  console.error(`[adapter-drift-check] ${failures.length} drift(s) across ${SUPPORTED_SESSION_PROVIDERS.length} platforms`);
  process.exit(1);
}
console.log(`[adapter-drift-check] OK: ${SUPPORTED_SESSION_PROVIDERS.length} platforms — declared artifact names/versions match the pinned fixtures`);
