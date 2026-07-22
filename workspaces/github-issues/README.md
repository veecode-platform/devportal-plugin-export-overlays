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
1.53. PR #151 published this exact workspace tree in isolation so its bytes
could be tested before PR #150 changes the shared `github` workspace. The RC1
controlled A/B changed `R2-CRASH` to `R2-PASS-CONFIRMED` with the platform,
configuration, entity and probe profile held constant:

- landing PR: <https://github.com/veecode-platform/devportal-plugin-export-overlays/pull/150>
- evidence-only PR (never merge): <https://github.com/veecode-platform/devportal-plugin-export-overlays/pull/151>
- exact RC1 evidence: <https://github.com/veecode-platform/veecode-drydock/tree/main/poc/runtime-repair-specimen/evidence/rc1-landing>
- candidate publish: <https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29879152656>
- candidate smoke: <https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29879430566>
- source commit: `7504e2ecf184a9d8ff450f6801fafb9422c78da6`
- 1.53-retargeted candidate: `sha256:9b657a162c7cc2d2cf5f3326a3a8082138169a1e293b1043a68704ce4c2ac5d2`

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
