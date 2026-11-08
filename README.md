# Mulqi Better Harness

A native DeepSeek Harness plugin that gives your sessions a disciplined
**harness review** capability: the `better-harness` skill, its analysis CLI,
and the resource trees the review workflow reads, mounted into a profile as
one Cordis bundle row.

## What it does

| Capability | Surface |
|---|---|
| `better-harness` skill in the global skills layer | published at the custom-skill rank, visible to every session on the profile |
| Explicit-only invocation | the `skill` tool refuses model-facing calls for `better-harness`; only a user-written `/better-harness` gesture loads the body |
| Canonical verification gate | on each `/better-harness` gesture, the host verifies the winning skill definition against the shipped resource tree before the step proceeds |
| Analysis CLI | `node scripts/better-harness.mjs <command>` — readiness reports, host diagnostics, harness analysis, evidence bundles |
| Resource trees | `references/`, `models/`, `templates/` — the doctrine's reading material, shipped byte-identical |

The skill body itself is a doctrine document: it tells the agent how to run a
Better Harness review (scope, evidence bundle, finding tracks, reporting)
using the CLI for the mechanical steps.

## Requirements

- DeepSeek Harness `0.2.1-rc.2` (exact engine pin in the manifest; other
  releases are refused by the host's compatibility check)
- Node.js `>= 22.20.0`
- pnpm-managed profile (standard DSH profiles)

## Install

```bash
# from the DSH installation that owns the target profile
dsh plugin --profile <name> add /path/to/mulqi-better-harness
```

The command registers the package into the profile's bundle layers
automatically (the manifest declares `dsh.bundle.patch`). Restart the
profile to activate. No preset edits and no hand-written configuration are
needed.

To remove:

```bash
dsh plugin --profile <name> remove mulqi-better-harness
```

## Use it

In any session on the profile, type the gesture as your own message:

```
/better-harness
```

The host verifies the bundled skill against its resource tree, injects the
doctrine body, and the agent runs the review. The skill routes itself:
finding-bound fixes, manual direct fixes, and full reviews are separate
tracks inside the body.

The model can never trigger it on its own — a model-facing
`skill({ name: "better-harness" })` call is refused with:

> Mulqi Better Harness requires an explicit /better-harness gesture written by the user.

That is the point: harness reviews are deliberate work.

## Run the CLI

```bash
node <plugin-root>/scripts/better-harness.mjs --help
```

Typical entry points (see `docs/usage.md`):

```bash
# five-minute readiness report for the current repository
node <plugin-root>/scripts/better-harness.mjs report

# bounded read-only host diagnostics
node <plugin-root>/scripts/better-harness.mjs doctor --platform all
```

## Configuration

None by default. The bundle self-locates from its own install path. To bind
discovery and verification to a different complete Better Harness root
(a patched out-of-tree copy), add row config to the bundle row:

```yaml
- insert:
    - id: mulqi-bh
      name: mulqi-better-harness
      config:
        mulqiBetterHarnessRoot: /absolute/path/to/other-root
```

The override must be absolute; a literal `~` or a relative path is rejected
by the policy's own validation at apply time.

## Documentation

- `docs/usage.md` — installation, profiles, the gesture, CLI commands, troubleshooting
- `LICENSE` — MIT (this package)
- `NOTICE.md` — upstream attribution

## Develop

```bash
npm install --no-package-lock --no-save   # or pnpm install
npm test                                   # node --test tests/*.test.js
```

The test suite covers the provider, the policy, registration, manifest
contract, and vendor integrity.
