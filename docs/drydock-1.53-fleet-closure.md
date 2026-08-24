# Drydock Backstage 1.53 fleet closure

## Outcome

The versioned `bs_1.53.0` plugin line was republished after repairing the five
remaining RC1 boot failures, then measured across all 96 packages by Drydock.
The hardened run has zero runtime crashes and zero boot failures. One known
install incompatibility remains: `rhdh-bsp-extensions-backend` duplicates the
`marketplace` plugin ID already compiled into `veecode/devportal:2.3.0-rc.1`.

This is technical closure of the remediable boot queue, not a production
promotion or an all-pass claim.

## Repair and publication ledger

| Package | Metadata/config repair | Landing |
| --- | --- | --- |
| Analytics Segment | supply a boolean dummy for `SEGMENT_TEST_MODE` | Drydock [PR #14](https://github.com/veecode-platform/veecode-drydock/pull/14) |
| GitHub Workflows backend | supply a numeric dummy for `GITHUB_APP_ID` | Drydock [PR #14](https://github.com/veecode-platform/veecode-drydock/pull/14) |
| Jenkins backend | use the top-level Jenkins configuration supported by the RC1 image | overlays [PR #153](https://github.com/veecode-platform/devportal-plugin-export-overlays/pull/153) |
| Grafana | move `grafana.domain` to the plugin schema root | overlays [PR #154](https://github.com/veecode-platform/devportal-plugin-export-overlays/pull/154) |
| GitHub Discussions search backend | provide a valid repository URL dummy and its matching GitHub integration | Drydock [PR #15](https://github.com/veecode-platform/veecode-drydock/pull/15) and overlays [PR #154](https://github.com/veecode-platform/devportal-plugin-export-overlays/pull/154) |

The first metadata landing merged as `4dcc560fe0115911efb17b1f8a8d3fa4444545bb`;
its [publisher run 29887232605](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29887232605)
completed 45/45 jobs successfully. The final metadata landing merged as
`9cfd0bcd8b99538f4f6f22120595a56e65d07cbf`; its
[publisher run 29887669387](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29887669387)
also completed 45/45 jobs successfully.

## Hardened fleet result

[Drydock run 29888094741](https://github.com/veecode-platform/veecode-drydock/actions/runs/29888094741)
checked out this repository at the exact final landing commit above and tested
`veecode/devportal:2.3.0-rc.1` with the settled `bs_1.53.0` bundle tag.

| Verdict | Count |
| --- | ---: |
| `R2-PASS-CONFIRMED` | 8 |
| `R2-PASS-WEAK` | 31 |
| `R2-CRASH` | 0 |
| `R1-OK` | 48 |
| `R1-COLLISION` | 8 |
| `R1-FAIL-BOOT` | 0 |
| `R0-FAIL-INSTALL` | 1 |

The permanent matrix, grouped nine-item worklist, exact run metadata, checksums
and all 547 raw report files are retained in
[Drydock evidence](https://github.com/veecode-platform/veecode-drydock/tree/main/evidence/fleet/29888094741).
The evidence closure merged in [Drydock PR #16](https://github.com/veecode-platform/veecode-drydock/pull/16)
as `23731ffef2e9b347bb0fb4817143c89e812ac70a`.

The remaining worklist contains eight evidence-coverage items and the one
Extensions product decision. It contains no `fix-metadata`, `creds-needed`, or
`repair-runtime` item.

### Extensions backend — release-owner decision (2026-07-22)

The release owner chose to **remove `rhdh-bsp-extensions-backend` from the
export** rather than accept it as a standing fleet exception. It was already
absent from the Extensions vitrine (PR #147); this PR removes the two source
inputs that still built and published it: the `plugins/extensions-backend`
target in `workspaces/extensions/plugins-list.yaml` and its
`workspaces/extensions/metadata/rhdh-bsp-extensions-backend.yaml` Package
entity. The sibling `rhdh-bsp-extensions` frontend and
`rhdh-bsp-ctlg-backend-mod-extensions` catalog module are intentionally kept.

Once this lands, the next versioned `bs_1.53.0` publish no longer carries the
backend, so the fleet's sole `R0-FAIL-INSTALL` is superseded by removal. The
hardened run 29888094741 above stays the immutable record of the pre-removal
96-package measurement; the other 95 verdicts are unaffected, so the fleet is
not re-run.

## Compatibility badge recovery

The final landing's
[compatibility run 29887669152](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29887669152)
was red only in `update-badge`: `actions/checkout` could not find the
repository's `metadata` branch. The `prepare-required-plugins` and actual
`check / Check` jobs both passed.

The branch is the workflow's intended bot-owned data store and exists in the
upstream repository, but had never been initialized in this fork. It was
bootstrapped from the upstream branch without changing any workflow. Manual
[run 29889680947](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29889680947)
then completed all three jobs successfully and refreshed the fork's badge data
at `811c8507` to 0 incompatible workspaces, 0 mandatory.

## Release boundary

Every publication referenced here is versioned. Nothing in this record moves
`plugin-catalog-index:latest` or `veecode/devportal:latest`. Those remain
separate human-approved production decisions.
