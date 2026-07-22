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
flow. The permanent workspace was then retargeted explicitly to Backstage
1.53. Release-specific publish, smoke, digest and runtime provenance lives in
the [landing record](../../docs/github-issues-1.2.1-landing.md). Keeping that
evidence outside this directory prevents an evidence refresh from changing the
workspace tree and therefore the artifact being proven.

## Build seam

The patch only delegates the repository-root `tsc` command into the nested
GitHub workspace after an immutable install. It does not modify plugin source.
The exported package is retargeted explicitly through `backstage.json` and
must pass the overlay publish checks plus a fresh Drydock probe before merge.

## E2E ownership

The existing GitHub Issues E2E project moves with this workspace, including
its explicit plugin configuration and lockfile. The shared `github` workspace
keeps only its GitHub Actions project. This ensures PR-mode artifact resolution
uses this workspace's source pin, package list and metadata instead of testing
an artifact that the shared workspace no longer exports.
