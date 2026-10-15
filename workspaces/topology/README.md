# Topology legacy entry

`plugins/topology/scalprum-config.json` exposes the legacy entry of
`@backstage-community/plugin-topology` to the 3.x portal.

| Module | Source file | Used by |
| --- | --- | --- |
| `PluginRoot` | `src/legacy.ts` | `mountPoints`: `TopologyPage` |
| `Alpha` | `src/translations/index.ts` | `translationResources`: `topologyTranslations`, `topologyTranslationRef` |

## Why it exists

The VeeCode 3.x portal runs Backstage 1.54.9 on the old frontend system. It
loads plugins through Scalprum and mounts the components, APIs and
translations that a legacy `createPlugin` plugin exports.

At `3033a1c` (version 3.0.7), `src/index.ts` default-exports the
new-frontend-system plugin from `./plugin`, and `package.json` has no
`scalprum` key. Without the overlay, rhdh-cli 1.11.2 exposes `src/index.ts` as
`PluginRoot` and exposes no `Alpha` module, so `TopologyPage` is missing and the
translation item names a module that does not exist. The portal does not fail.
It logs a console warning (`Plugin <scope> is not configured properly:
PluginRoot.TopologyPage not found, ignoring mountPoint: ...`), and the plugin
silently does not render.

## Check on a source bump

1. Confirm that `package.json` at the new ref still has a `./legacy` export
   that points at `src/legacy.ts`. If upstream removed it, this overlay cannot
   work, and the workspace has to stay on the last ref that has it.
2. After the export, confirm that `PluginRoot` and `Alpha` export every name
   that the metadata uses (the table above). The root `CLAUDE.md` section
   "Frontends for the VeeCode 3.x portal" describes how to read the exports.
3. Keep `name` equal to the key under `dynamicPlugins.frontend` in the
   metadata.

A published per-plugin tag (`bs_<backstage>__<version>`) is immutable: the
publish skips the push with a notice when the tag exists, and the job still
passes. A build that exposes the wrong entry needs a new plugin version, or the
ADR-008 exception path (`.github/workflows/delete-plugin-tags.yaml`), which
deletes the tag and records the decision.
