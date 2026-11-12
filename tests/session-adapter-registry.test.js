/**
 * Mulqi Better Harness — session-adapter registry gate.
 *
 * For every platform in the session-analysis registry, the module's declared
 * PLATFORM_SESSION_ARTIFACT_CONTRACT (the artifact names the adapter accepts,
 * and the format-version range it enforces, if any) must line up with the
 * fixtures on disk under tests/fixtures/session-analysis/<platform>/.
 *
 * Each fixture directory carries a fixtures.json sidecar mapping fixture
 * files to the host artifact name they represent, the artifact version (when
 * the adapter gates on one), and the expected disposition. This gate pins
 * the defect class where an adapter's accepted artifact names or supported
 * versions drift from what the host actually writes: discovery silently
 * yields zero sessions with no diagnostic (the version-4 DSH incident).
 */

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createAnalyzer, SUPPORTED_SESSION_PROVIDERS } from '../scripts/session-analysis/analyzer.mjs'
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as augment } from '../scripts/session-analysis/platforms/augment.mjs'
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as claude } from '../scripts/session-analysis/platforms/claude.mjs'
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as codex } from '../scripts/session-analysis/platforms/codex.mjs'
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as copilot } from '../scripts/session-analysis/platforms/copilot.mjs'
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as cursor } from '../scripts/session-analysis/platforms/cursor.mjs'
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as dsh } from '../scripts/session-analysis/platforms/dsh.mjs'
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as grok } from '../scripts/session-analysis/platforms/grok.mjs'
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as harnessRun } from '../scripts/session-analysis/platforms/harness-run.mjs'
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as kimi } from '../scripts/session-analysis/platforms/kimi.mjs'
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as pi } from '../scripts/session-analysis/platforms/pi.mjs'
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as qoder } from '../scripts/session-analysis/platforms/qoder.mjs'
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as qwen } from '../scripts/session-analysis/platforms/qwen.mjs'
import { PLATFORM_SESSION_ARTIFACT_CONTRACT as workbuddy } from '../scripts/session-analysis/platforms/workbuddy.mjs'

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
})

const FIXTURES_ROOT = path.resolve(fileURLToPath(new URL('./fixtures/session-analysis/', import.meta.url)))

test('the registry and the contract map cover exactly the same platforms', () => {
  assert.deepEqual(
    [...SUPPORTED_SESSION_PROVIDERS].sort(),
    [...Object.keys(CONTRACTS)].sort(),
    'a registry platform without a declared contract (or a contract for a platform the registry does not load) must fail this gate',
  )
})

for (const platform of SUPPORTED_SESSION_PROVIDERS) {
  test(`${platform}: the registry thunk loads the adapter and the module declares a well-formed artifact contract`, async () => {
    const analyzer = await createAnalyzer(platform)
    assert.equal(typeof analyzer.discoverSessions, 'function', `${platform} adapter must implement discoverSessions`)
    const contract = CONTRACTS[platform]
    assert.ok(Object.isFrozen(contract), 'the artifact contract must be frozen')
    assert.equal(contract.platform, platform, 'the contract must name its platform')
    assert.ok(
      Array.isArray(contract.artifactNames) && contract.artifactNames.length > 0,
      'artifactNames must list the accepted artifact names',
    )
    for (const pattern of contract.artifactNames) {
      assert.ok(pattern instanceof RegExp, `artifactNames entries must be RegExp, got ${String(pattern)}`)
    }
    const versions = contract.supportedVersions
    assert.ok(
      versions === null
        || (Array.isArray(versions) && versions.length === 2
            && versions.every((value) => Number.isInteger(value)) && versions[0] <= versions[1]),
      'supportedVersions must be null or an integer [min, max] range',
    )
  })

  test(`${platform}: declared artifact names and versions match the fixtures on disk`, () => {
    const contract = CONTRACTS[platform]
    const dir = path.join(FIXTURES_ROOT, platform)
    assert.ok(existsSync(dir), `missing fixture directory tests/fixtures/session-analysis/${platform}/`)
    const sidecarPath = path.join(dir, 'fixtures.json')
    assert.ok(existsSync(sidecarPath), `missing sidecar tests/fixtures/session-analysis/${platform}/fixtures.json`)
    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'))
    assert.equal(sidecar.platform, platform, 'the sidecar must name its platform')
    assert.ok(Array.isArray(sidecar.artifacts) && sidecar.artifacts.length > 0, `${platform} must pin at least one fixture`)

    const onDisk = new Set(readdirSync(dir).filter((name) => name !== 'fixtures.json'))
    const listed = new Set(sidecar.artifacts.map((entry) => entry.file))
    assert.deepEqual(
      [...onDisk].sort(),
      [...listed].sort(),
      'fixture files on disk and the sidecar entries must agree exactly',
    )

    const versions = contract.supportedVersions
    for (const entry of sidecar.artifacts) {
      const hostName = entry.hostArtifactName ?? entry.file
      assert.ok(
        contract.artifactNames.some((pattern) => pattern.test(hostName)),
        `${platform}: fixture host artifact "${hostName}" matches no declared artifact-name pattern — declare it in the adapter contract or drop the fixture`,
      )
      assert.ok(
        entry.expected === 'eligible' || entry.expected === 'unsupported-version',
        `fixture ${entry.file}: unexpected disposition ${JSON.stringify(entry.expected)}`,
      )
      if (entry.version !== undefined) {
        assert.ok(
          versions !== null,
          `${platform}: fixture ${entry.file} declares version ${entry.version} but the adapter declares no supported-version range`,
        )
      }
      if (versions && entry.version !== undefined) {
        const inRange = entry.version >= versions[0] && entry.version <= versions[1]
        if (entry.expected === 'eligible') {
          assert.ok(
            inRange,
            `${platform}: eligible fixture ${entry.file} version ${entry.version} is outside the declared range [${versions[0]}, ${versions[1]}]`,
          )
        } else {
          assert.ok(
            !inRange,
            `${platform}: fixture ${entry.file} is marked unsupported-version but ${entry.version} is inside the declared range [${versions[0]}, ${versions[1]}]`,
          )
        }
      }
    }

    const eligible = sidecar.artifacts.filter((entry) => entry.expected === 'eligible')
    assert.ok(eligible.length > 0, `${platform} must pin at least one eligible fixture`)
    if (versions) {
      assert.ok(
        eligible.some((entry) => entry.version === versions[1]),
        `${platform}: no eligible fixture pins the top of the declared supported-version range [${versions[0]}, ${versions[1]}] — a newer host version would drop silently`,
      )
    }
  })
}
