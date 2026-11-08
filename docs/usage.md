# Usage

Operational guide for the Mulqi Better Harness plugin: installation, the
`/better-harness` gesture, the CLI, configuration, and troubleshooting.

## Installation

```bash
# install a local folder into a profile
dsh plugin --profile <name> add /absolute/path/to/mulqi-better-harness
```

The host resolves the package into the profile's `node_modules`, reconciles
the `dsh.bundle.patch` declaration into `dsh.profile.bundles`, and mounts
the bundle row on the next profile start. The install line looks like:

```
+ mulqi-better-harness 0.1.0 <- /absolute/path/to/mulqi-better-harness
```

Confirm the mount in the dumped configuration:

```bash
dsh --profile <name> --dump-config | grep mulqi-better-harness
```

Expect the row and no `skipping profile bundle` line.

Remove it symmetrically:

```bash
dsh plugin --profile <name> remove mulqi-better-harness
```

The next profile start disposes the skill provider, the guard, and the
verification gate with the bundle's fiber.

## The /better-harness gesture

Type the gesture as your own message in any session on the profile:

```
/better-harness
```

What the host does, in order:

1. Detects the gesture in user-authored text (model-authored text never
   counts).
2. Looks up the winning `better-harness` skill definition in the global
   skills layer, scoped to the running agent and session cwd.
3. Verifies the winner against the canonical root: the winner must be the
   `custom`-source skill bound to the shipped `skills/better-harness/`
   directory, user-invocable, with every required resource present
   (`skills/better-harness/SKILL.md`, `scripts/better-harness.mjs`,
   `references/`, `models/`, `templates/`).
4. If the verification passes, the step proceeds and the doctrine body is
   injected; the agent then runs the review.

If any check fails, the step is blocked with an error naming the failing
reasons, for example:

```
mulqi-better-harness: /better-harness verification failed: skill-not-discovered
```

Reason keys: `skill-not-discovered`, `winner-source-mismatch`,
`winner-path-mismatch`, `resource-base-mismatch`,
`root-invariant-mismatch`, `user-invocation-disabled`,
`required-resource-missing:<path>`, `symbolic-link-not-supported:<path>`.

### Why explicit-only?

A harness review is deliberate work with durable outputs (finding reports,
repair plans). The guard makes the model ask instead of acting: any
model-facing `skill({ name: "better-harness" })` call is refused with:

> Mulqi Better Harness requires an explicit /better-harness gesture written by the user.

If a review is warranted mid-task, the agent tells you and you type the
gesture.

## The CLI

The analysis tooling is shipped at `scripts/better-harness.mjs`:

```bash
BH=/path/to/mulqi-better-harness/scripts/better-harness.mjs
node $BH --help
```

| Command | Purpose |
|---|---|
| `report` | Gather static evidence and hand off to the skill for a five-minute readiness report |
| `doctor` | Bounded, read-only runtime and host diagnostics (`--platform all`) |
| `harness evidence-bundle` | Collect the evidence bundle a review runs on |
| `harness analyze` | Analyze an evidence bundle |
| `harness checkup` | Run the readiness checkup |
| `harness record-fix-output` | Record a finding-bound fix result |
| `upload` | Prepare a redacted, reviewable task-evidence upload plan |

`report` and `doctor` are read-only; `upload` prepares a plan but applies it
only to the destination it names. Run from inside the repository you want
reviewed.

## Configuration

The row ships without configuration; discovery and verification bind to the
package's own install path (self-located from the module URL, so moving or
reinstalling the package needs no edits).

To use a different complete Better Harness root (a patched out-of-tree
copy), add row config:

```yaml
- insert:
    - id: mulqi-bh
      name: mulqi-better-harness
      config:
        mulqiBetterHarnessRoot: /absolute/path/to/other-root
```

Validation rules:

- must be a non-empty absolute path
- a literal `~` is rejected (the host does not expand it)
- relative paths are rejected (they drift with the working directory)
- the resolved root must be canonical (symlinked layouts are
  canonicalized, then verified like the packaged one)

## Troubleshooting

| Symptom | Check |
|---|---|
| `skipping profile bundle` in the log | the host version is not the pinned `0.2.1-rc.2`; the manifest pin is exact — run the matching release |
| install refused as incompatible | same as above; do not use a version exemption to keep a broken mount |
| gesture blocked with `skill-not-discovered` | the skill did not publish: look for provider warnings (`cannot read ...SKILL.md`, `declares no description`) in the profile log |
| gesture blocked with `required-resource-missing:<path>` | a resource tree was removed from the install; reinstall the package or point `mulqiBetterHarnessRoot` at a complete root |
| the skill is absent from the catalog entirely | confirm the profile actually lists the package in `dsh.profile.bundles` (`--dump-config | grep mulqi-better-harness`) |
| CLI says `Cannot find module 'yaml'` | the dependencies were not installed; run `pnpm install` in the profile (or `npm install` in the local folder before mounting it) |

## Files

```
index.js            Cordis entry: registers provider + guard + gate
lib/provider.js     skill provider (catalog shape, fail-closed frontmatter)
lib/policy.js       gesture, guard, root validation, canonical verification
cordis.patch.yml    the one-row bundle patch
skills/…            the canonical skill doctrine
scripts/…           the analysis CLI and its tooling
references/ models/ templates/   resource trees the doctrine reads
```
