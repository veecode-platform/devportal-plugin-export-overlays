# GitHub Issues 1.2.1 landing record

## Outcome

`@backstage-community/plugin-github-issues` is isolated in its own export
workspace, pinned to upstream `1.2.1`, and explicitly targeted to Backstage
`1.53`. The change repairs the catalog-entity crash without advancing the five
unrelated plugins that remain in `workspaces/github`.

The candidate was published from an evidence-only PR and exercised against
`veecode/devportal:2.3.0-rc.1` before the permanent landing. PR #150 is now
merged, PR #151 is closed without merge, and the exact stable `bs_1.53.0`
digest passed a focused RC1 proof and was remeasured in the final full-fleet
matrix.

## Change boundary

- Landing PR: <https://github.com/veecode-platform/devportal-plugin-export-overlays/pull/150>
- Evidence-only PR: <https://github.com/veecode-platform/devportal-plugin-export-overlays/pull/151> — closed without merge
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
immutable candidate is recorded below.

| Iteration | Candidate digest | Publish | Smoke | RC1 runtime proof |
| --- | --- | --- | --- | --- |
| Initial 1.53 candidate | `sha256:9b657a162c7cc2d2cf5f3326a3a8082138169a1e293b1043a68704ce4c2ac5d2` | [29879152656](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29879152656) | [29879430566](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29879430566) | [`rc1-landing`](https://github.com/veecode-platform/veecode-drydock/tree/main/poc/runtime-repair-specimen/evidence/rc1-landing) |
| E2E ownership synchronized | `sha256:7e01e33aa70b6fa15bd8af79164767b5efd0e9895d693ce8917c50ae09396e69` | [29881777258](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29881777258) | [29882018190](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29882018190) | [`rc1-landing-e2e-sync`](https://github.com/veecode-platform/veecode-drydock/tree/main/poc/runtime-repair-specimen/evidence/rc1-landing-e2e-sync) |

The synchronized iteration also passed [E2E Code Quality run
29881768077](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29881768077),
[appConfigExamples run
29881768059](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29881768059).

An optional full OCP E2E was requested but did not execute. The [PR Actions
run 29882448234](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29882448234)
was skipped, while [Fullsend run
29882448189](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29882448189)
only routed the comment and skipped every execution agent. It receives no
evidence credit and is not a documented gate for this landing.

## Final candidate

Volatile provenance was removed from the workspace before this publication.
The Git tree below is therefore identical in PRs #150 and #151 and does not
change when this record is updated.

| Field | Value |
| --- | --- |
| Landing commit | `ba6eea18fb7ec32efebcf562d7f1cba1837f9a8b` |
| Landing PR merge commit | `03b8ca0d694c7c9854346e0bc803550df8bb8981` |
| Candidate commit | `3acd505247ef7ee3458da5d405ab32a45717886e` |
| Workspace Git tree | `8f60a0f886fb0345ee7e6a2b2026526b849d44d1` |
| OCI digest | `sha256:ba835e4eb4d353b3a5aef6433d20b07c0068352c3d45ea18ff41e93f85f8724c` |
| Publish run | [29882709210](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29882709210) — PASS |
| Smoke run | [29882937217](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29882937217) — PASS |
| Candidate E2E Code Quality | [29882699252](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29882699252) — PASS |
| Candidate appConfigExamples | [29882699183](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29882699183) — PASS |
| Landing E2E Code Quality | [29882676532](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29882676532) — PASS |
| Landing appConfigExamples | [29882676570](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29882676570) — PASS |
| RC1 controlled A/B | [Drydock PR #12](https://github.com/veecode-platform/veecode-drydock/pull/12), [`rc1-landing-final`](https://github.com/veecode-platform/veecode-drydock/tree/main/poc/runtime-repair-specimen/evidence/rc1-landing-final) — `PROVEN`, `R2-CRASH` to `R2-PASS-CONFIRMED` |

## Stable and fleet closure

| Field | Value |
| --- | --- |
| Stable artifact | `oci://quay.io/veecode/github-issues:bs_1.53.0!backstage-community-plugin-github-issues` |
| Stable digest | `sha256:53a4ce420597b82ab1377b069842f459d0dc8e7857374282f7a6cc5e332dd74b` |
| Main publisher | [run 29884038683](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29884038683) — 45/45 jobs PASS |
| Exact stable RC1 proof | [`rc1-stable`](https://github.com/veecode-platform/veecode-drydock/tree/main/poc/runtime-repair-specimen/evidence/rc1-stable) — `PROVEN`, `R2-PASS-CONFIRMED` |
| Final full fleet | [Drydock run 29884693095](https://github.com/veecode-platform/veecode-drydock/actions/runs/29884693095) — workflow PASS, GitHub Issues `R2-PASS-CONFIRMED`, fleet `R2-CRASH` count 0 |
| Durable fleet evidence | [`evidence/fleet/29884693095`](https://github.com/veecode-platform/veecode-drydock/tree/main/evidence/fleet/29884693095) |

## Required landing sequence

- [x] Publish the final immutable workspace from PR #151.
- [x] Resolve its OCI digest and run a fresh exact-digest probe on RC1.
- [x] Record the final provenance here and in Drydock.
- [x] Merge the Drydock evidence PR — #12 merged as `b0a38b071d6d3942710c4c02801a16cc6ff3c6dd`.
- [x] Merge landing PR #150 — merged as `03b8ca0d694c7c9854346e0bc803550df8bb8981`.
- [x] Close PR #151 without merging.
- [x] Verify the exact stable `bs_1.53.0` digest on RC1.
- [x] Run the final full fleet matrix after the stable publisher settled.

No step in this record authorizes changing or promoting `:latest`.
