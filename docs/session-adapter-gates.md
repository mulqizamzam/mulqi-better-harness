# Session-adapter gates — maintenance reference

What this repo pins, and what to touch when the host side moves.

## The three gates

1. **CI syntax gate** (`.github/workflows/ci.yml`)
   Every tracked `.mjs` under `scripts/` is syntax-checked:
   `git ls-files 'scripts/*.mjs' 'scripts/**/*.mjs' | xargs -r -n1 node --check`.
   A new or renamed `.mjs` file is covered the moment it is tracked — no
   hand-list to update. (The package root `index.js` and `lib/*.js` stay
   covered transitively: the test suite imports all of them.)

2. **Per-adapter focused tests** (`tests/session-adapter-<platform>.test.js`)
   One test file per registry platform, each pinning a minimal host-shaped
   fixture under `tests/fixtures/session-analysis/<platform>/` and
   asserting the adapter discovers the expected session (exact `sessionId`,
   workspace-scoped root path). This is the gate that catches the
   *silent zero-session* defect class: an adapter that stops matching the
   names/versions the host actually writes fails loudly instead of
   returning an empty result. Precedent: the DSH version-4 incident —
   an unversioned-only matcher + exact version-0 gate silently dropped
   `session.v4.jsonl` artifacts.

3. **Registry cross-check** (`tests/session-adapter-registry.test.js`)
   Each platform module exports a frozen `PLATFORM_SESSION_ARTIFACT_CONTRACT`
   (accepted artifact-name patterns + supported format-version range, or
   `null`). The registry test asserts, per platform:
   - the registry (`SUPPORTED_SESSION_PROVIDERS`) and the contract map cover
     exactly the same platforms;
   - the registry thunk loads a working analyzer;
   - the fixture directory + `fixtures.json` sidecar agree exactly
     (file set, host artifact names, dispositions);
   - every fixture's host artifact name matches a declared pattern;
   - for version-gated platforms (currently only dsh, range `[0, 4]`):
     eligible fixture versions sit **inside** the declared range,
     `unsupported-version` fixtures sit outside it, and at least one
     eligible fixture pins the **top** of the range — so extending the
     range without fixture coverage fails the gate.

   The same cross-check is available standalone (no test framework):
   `node scripts/self-audit/adapter-drift-check.mjs` — exit 0/1, for use
   from hooks or push steps.

## House rules

- **Vendor lockstep**: everything under `scripts/`, `skills/`,
  `references/`, `models/`, `templates/` (+ `LICENSE`) is hashed into
  `audit/vendor-inventory.sha256`. Any change to those trees must be
  committed **together with** a refreshed manifest:
  `node scripts/self-audit/regen-manifest.mjs` then commit tree + manifest
  in one commit. The installed pre-commit hook
  (`.git/hooks/pre-commit` → `scripts/self-audit/pre-commit.mjs`)
  automates this: staging a vendored path triggers a regen and re-stages
  the manifest automatically.
- `tests/` is **not** a vendor root — fixture/test churn never touches
  the manifest.
- A skip must never read as a pass: `tests/vendor-integrity.test.js`
  fails on a missing manifest anywhere except a recognised public clone,
  and `integrity-execution-guard.mjs` re-runs it after the suite.

## New checkout

The pre-commit hook lives in `.git/hooks/` (per-checkout, untracked); the
tracked helper is `scripts/self-audit/pre-commit.mjs`. Install the hook in
a fresh checkout with:

```sh
printf '#!/bin/sh\nexec node "$(git rev-parse --show-toplevel)/scripts/self-audit/pre-commit.mjs"\n' > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

Without the hook the manifest-lockstep rule still holds — it is just
enforced by the suite + CI instead of at commit time.

## Adding a platform

1. Register it in `PLATFORM_MODULES` in `scripts/session-analysis/analyzer.mjs`
   (thunk + analyzer class name) and create `scripts/session-analysis/platforms/<host>.mjs`.
2. Export the frozen `PLATFORM_SESSION_ARTIFACT_CONTRACT` from the module,
   next to the code that enforces it (patterns derived from the adapter's
   own matchers; `supportedVersions: null` unless the code genuinely gates
   on a format version).
3. Add `tests/session-adapter-<host>.test.js` (one focused test) +
   `tests/fixtures/session-analysis/<host>/` with the minimal fixture(s)
   and a `fixtures.json` sidecar (`platform`, `artifacts[]` with
   `file`, `hostArtifactName`, `version` only when version-gated,
   `expected`: `eligible` | `unsupported-version`).
4. The registry test and the drift-check pick the platform up
   automatically; the CI syntax gate picks up the new `.mjs` file
   automatically once tracked.
5. Commit the platform module + contract together with a refreshed
   vendor manifest.

## Bumping a supported version (dsh example)

1. Widen `DSH_SESSION_FORMAT_VERSIONS` in `platforms/dsh.mjs`
   (e.g. `[0, 4]` → `[0, 5]`).
2. The registry gate now fails on the top-of-range pin: add a
   version-5 fixture + sidecar entry (`"version": 5, "expected":
   "eligible"`), and move the old `unsupported-header` fixture to the new
   out-of-range version.
3. Refresh the manifest, commit together.

## Known pitfalls pinned by fixtures

- **qoder slug leading dash**: qoder's slugger does not strip the leading
  separator of an absolute POSIX path, so the on-disk project dir for
  `/home/fixture-qoder/ws1` is `-home-fixture-qoder-ws1` (leading dash).
  Manual inspection of a qoder home expecting the un-dashed slug finds
  nothing. Pinned by `tests/session-adapter-qoder.test.js`.
- **harness-run hard gate**: a `trace.jsonl` without its sibling
  `revision.json` is silently skipped; the fixture pins both files.
- **pi env dependency**: pi's session-dir layout honours
  `PI_CODING_AGENT_SESSION_DIR`; its test unsets/restores it hermetically.
  The pi session-header `version` is *recorded*, not gated — the contract
  correctly declares `supportedVersions: null`.
