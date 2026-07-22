# GitHub Issues isolated export

This workspace exports only `@backstage-community/plugin-github-issues`.
It is intentionally separate from `workspaces/github`, whose pinned source
commit supplies several unrelated plugins.

## Why it exists

The shared workspace previously shipped `0.21.0`, which crashes when a catalog
entity comes from a `file:` location because it constructs a `URL` from a
filesystem path. Upstream `1.2.1` contains the compatible fix. Updating the
shared source ref would also change five sibling plugins, so this workspace
keeps that change isolated.

The source pin and package version were selected by the Drydock runtime-repair
flow. Its controlled A/B changed `R2-CRASH` to `R2-PASS-CONFIRMED` with the
platform, configuration, entity and probe profile held constant:

- evidence: <https://github.com/veecode-platform/veecode-drydock/tree/main/poc/runtime-repair-specimen/evidence>
- source commit: `7504e2ecf184a9d8ff450f6801fafb9422c78da6`
- proven candidate: `sha256:45565c635c2385db908a75e2dccad18e9a9daea07a80def39eb4e93986f10b7e`

## Build seam

The patch only delegates the repository-root `tsc` command into the nested
GitHub workspace after an immutable install. It does not modify plugin source.
The exported package is retargeted explicitly through `backstage.json` and
must pass the overlay publish checks plus a fresh Drydock probe before merge.
