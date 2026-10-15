# Segment analytics legacy entry

`plugins/analytics-provider-segment/scalprum-config.json` exposes the legacy
entry of `@backstage-community/plugin-analytics-provider-segment` to the 3.x
portal. This note covers only that plugin.

| Module | Source file | Used by |
| --- | --- | --- |
| `PluginRoot` | `src/legacy.ts` | `analyticsApiExtensions`: `SegmentAnalytics` |

## Why it exists

The VeeCode 3.x portal runs Backstage 1.54.9 on the old frontend system. It
loads plugins through Scalprum and mounts the components, APIs and
translations that a legacy `createPlugin` plugin exports.

At `85ba724` (version 2.0.0), `src/index.ts` of the plugin is
`export { segmentModule as default } from './module'`, a new-frontend-system
module. Without the overlay, rhdh-cli 1.11.2 exposes `src/index.ts` as
`PluginRoot`, and `SegmentAnalytics` is not in it. The portal does not fail. It
logs a console warning (`Plugin <scope> is not configured properly:
PluginRoot.SegmentAnalytics not found, ignoring analyticsApi:
SegmentAnalytics`) and does not register the Segment provider.

## Check on a source bump

1. Confirm that `package.json` at the new ref still has a `./legacy` export
   that points at `src/legacy.ts`. If upstream removed it, this overlay cannot
   work, and the workspace has to stay on the last ref that has it.
2. After the export, confirm that `PluginRoot` exports every name that the
   metadata uses (the table above). The root `CLAUDE.md` section "Frontends
   for the VeeCode 3.x portal" describes how to read the exports.
3. Keep `name` equal to the key under `dynamicPlugins.frontend` in the
   metadata.

A published per-plugin tag (`bs_<backstage>__<version>`) is immutable: the
publish skips the push with a notice when the tag exists, and the job still
passes. A build that exposes the wrong entry needs a new plugin version, or the
ADR-008 exception path (`.github/workflows/delete-plugin-tags.yaml`), which
deletes the tag and records the decision.
