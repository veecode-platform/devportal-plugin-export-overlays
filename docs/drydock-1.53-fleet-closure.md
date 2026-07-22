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
`repair-runtime` item. The Extensions backend is already absent from the
Extensions vitrine; removing it from export or accepting it as an explicit
fleet exception remains a release-owner decision.

## Compatibility workflow signal

The final landing's
[compatibility run 29887669152](https://github.com/veecode-platform/devportal-plugin-export-overlays/actions/runs/29887669152)
is red only in `update-badge`: `actions/checkout` cannot find the repository's
`metadata` branch. The `prepare-required-plugins` and actual `check / Check`
jobs both passed. This is CI badge hygiene, not a plugin compatibility failure;
no workflow was changed as part of this closure.

## Release boundary

Every publication referenced here is versioned. Nothing in this record moves
`plugin-catalog-index:latest` or `veecode/devportal:latest`. Those remain
separate human-approved production decisions.
