# Bulk Import legacy entry

`plugins/bulk-import/scalprum-config.json` exposes the legacy entry of
`@red-hat-developer-hub/backstage-plugin-bulk-import` to the 3.x portal.

| Module | Source file | Used by |
| --- | --- | --- |
| `PluginRoot` | `src/legacyExports.ts` | `appIcons`: `BulkImportIcon`; `dynamicRoutes`: `BulkImportPage` |
| `Legacy` | `src/legacyExports.ts` | the same entry as `PluginRoot`, under a second name |
| `Alpha` | `src/alpha.ts` | `translationResources`: `bulkImportTranslations`, `bulkImportTranslationRef` |

## Why it exists

The VeeCode 3.x portal runs Backstage 1.54.9 on the old frontend system. It
loads plugins through Scalprum and mounts the components, APIs and
translations that a legacy `createPlugin` plugin exports.

At `caf5cde` (version 9.1.1), `.` of the plugin is `./src/index.tsx`, a
new-frontend-system entry, and `package.json` has no `scalprum` key.
rhdh-cli 1.11.2 then defaults to `PluginRoot: ./src/index.ts`, which does not
exist, and the export fails with `Can't resolve './src/index.ts'`. Pointing
`PluginRoot` at `./src/index.tsx` would build, but it would expose the new
frontend system entry in place of the legacy exports that the portal mounts
(`BulkImportPage`, `BulkImportIcon`). In that case the portal does not fail on
a name it cannot find. It logs a console warning (`Plugin <scope> is not
configured properly: PluginRoot.BulkImportPage not found, ignoring
dynamicRoute: ...`), and the plugin silently does not render.

## Check on a source bump

1. Confirm that `package.json` at the new ref still has a `./legacy` export
   that points at `src/legacyExports.ts`. If upstream removed it, this overlay
   cannot work, and the workspace has to stay on the last ref that has it.
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
