# GitHub Issues 1.2.1 landing record

## Outcome

`@backstage-community/plugin-github-issues` is isolated in its own export
workspace, pinned to upstream `1.2.1`, and explicitly targeted to Backstage
`1.53`. The change repairs the catalog-entity crash without advancing the five
unrelated plugins that remain in `workspaces/github`.

The candidate is published from an evidence-only PR and exercised against
`veecode/devportal:2.3.0-rc.1` before the permanent landing PR is merged.

## Change boundary

- Landing PR: <https://github.com/veecode-platform/devportal-plugin-export-overlays/pull/150>
- Evidence-only PR: <https://github.com/veecode-platform/devportal-plugin-export-overlays/pull/151> — close without merge
- Upstream source: `backstage/community-plugins@7504e2ecf184a9d8ff450f6801fafb9422c78da6`
- Exported package: `@backstage-community/plugin-github-issues@1.2.1`
- Target platform: Backstage `1.53`
- Plugin source modifications: none
- Build seam: the repository-root `tsc` command delegates to the nested GitHub workspace after an immutable install
- E2E ownership: GitHub Issues configuration and test live under `workspaces/github-issues/e2e-tests`; the shared GitHub workspace retains only GitHub Actions

## Why provenance is outside the workspace

An OCI digest depends on the workspace bytes. Embedding that digest or the
publishing run inside `workspaces/github-issues/README.md` changes those bytes,
which requires another publish and produces another digest. This record lives
outside the workspace so the candidate tree can remain immutable while its
release evidence is completed.

## Evidence ledger

The first Backstage 1.53 candidate established the runtime repair. A subsequent
candidate synchronized E2E ownership into the isolated workspace and repeated
all required checks. These are retained as review iterations; the final
immutable candidate will be recorded below after the stable workspace text is
published once more.

| Iteration | Candidate digest | Publish | Smoke | RC1 runtime proof |
| --- | --- | --- | --- | --- |
| Initial 1.53 candidate | `sha256:9b657a162c7cc2d2cf5f3326a3a8082138169a1e293b1043a68704ce4c2ac5d2` | [29879152656](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29879152656) | [29879430566](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29879430566) | [`rc1-landing`](https://github.com/veecode-platform/veecode-drydock/tree/main/poc/runtime-repair-specimen/evidence/rc1-landing) |
| E2E ownership synchronized | `sha256:7e01e33aa70b6fa15bd8af79164767b5efd0e9895d693ce8917c50ae09396e69` | [29881777258](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29881777258) | [29882018190](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29882018190) | [`rc1-landing-e2e-sync`](https://github.com/veecode-platform/veecode-drydock/tree/main/poc/runtime-repair-specimen/evidence/rc1-landing-e2e-sync) |

The synchronized iteration also passed [E2E Code Quality run
29881768077](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29881768077),
[appConfigExamples run
29881768059](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29881768059),
and the additional [full OCP E2E run
29882448189](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29882448189).

## Final candidate

This section is completed only after the final candidate publish and exact RC1
probe. Until then, the iterations above are evidence of progress, not authority
to promote or merge the evidence-only PR.

| Field | Value |
| --- | --- |
| Candidate commit | Pending final publish |
| Workspace Git tree | Pending final publish |
| OCI digest | Pending final publish |
| Publish run | Pending final publish |
| Smoke run | Pending final publish |
| E2E Code Quality run | Pending final publish |
| appConfigExamples run | Pending final publish |
| RC1 controlled A/B | Pending exact-digest probe |

## Required landing sequence

1. Publish the final immutable workspace from PR #151.
2. Resolve its OCI digest and run a fresh exact-digest probe on RC1.
3. Record the final provenance here and in Drydock.
4. Merge the Drydock evidence PR.
5. Merge landing PR #150.
6. Close PR #151 without merging.
7. Verify the stable `bs_1.53.0` artifact on RC1, then run the full fleet matrix.

No step in this record authorizes changing or promoting `:latest`.
