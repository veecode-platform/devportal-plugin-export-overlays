# Multi Source Security Viewer legacy entry

`plugins/multi-source-security-viewer/scalprum-config.json` exposes the legacy
entry of `@backstage-community/plugin-multi-source-security-viewer` to the 3.x
portal.

| Module | Source file | Used by |
| --- | --- | --- |
| `PluginRoot` | `src/legacy.ts` | the deployment's own config: the metadata has no `appConfigExamples` |

## Why it exists

The VeeCode 3.x portal runs Backstage 1.54.9 on the old frontend system. It
loads plugins through Scalprum and mounts the components, APIs and
translations that a legacy `createPlugin` plugin exports.

At `a77b1b6` (version 1.0.3), `src/index.ts` default-exports the
new-frontend-system plugin from `./plugin`. The inline `scalprum` key of
upstream's `package.json` maps `PluginRoot` to `src/index.ts`. rhdh-cli 1.11.2
prefers the overlay over that key. Without the overlay, `PluginRoot` has no
entity content and no availability conditions (`EntityMultiCIPipelinesContent`,
`isMultiCIAvailable`). The portal does not fail. It logs a console warning for
each name a deployment's config asks for (`Plugin <scope> is not configured
properly: PluginRoot.<name> not found, ignoring ...`), and the plugin silently
does not render.

## Check on a source bump

1. Confirm that `package.json` at the new ref still has a `./legacy` export
   that points at `src/legacy.ts`. If upstream removed it, this overlay cannot
   work, and the workspace has to stay on the last ref that has it.
2. After the export, confirm that `PluginRoot` still exports the names that
   `src/legacy.ts` exports. The metadata names none, so the root `CLAUDE.md`
   section "Frontends for the VeeCode 3.x portal" applies to the export list
   alone.
3. Keep `name` equal to the Scalprum scope that deployments configure under
   `dynamicPlugins.frontend`.

A published per-plugin tag (`bs_<backstage>__<version>`) is immutable: the
publish skips the push with a notice when the tag exists, and the job still
passes. A build that exposes the wrong entry needs a new plugin version, or the
ADR-008 exception path (`.github/workflows/delete-plugin-tags.yaml`), which
deletes the tag and records the decision.
