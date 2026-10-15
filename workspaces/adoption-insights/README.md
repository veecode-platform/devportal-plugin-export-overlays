# Adoption Insights legacy entries

Two overlays expose the legacy entry of a plugin to the 3.x portal:

- `plugins/adoption-insights/scalprum-config.json` for
  `@red-hat-developer-hub/backstage-plugin-adoption-insights`
- `plugins/analytics-module-adoption-insights/scalprum-config.json` for
  `@red-hat-developer-hub/backstage-plugin-analytics-module-adoption-insights`

| Plugin | Module | Source file | Used by |
| --- | --- | --- | --- |
| `adoption-insights` | `PluginRoot` | `src/legacy.ts` | `appIcons`: `AdoptionInsightsIcon`; `dynamicRoutes`: `AdoptionInsightsPage` |
| `adoption-insights` | `Legacy` | `src/legacy.ts` | the same entry as `PluginRoot`, under a second name |
| `adoption-insights` | `Alpha` | `src/alpha.ts` | `translationResources`: `adoptionInsightsTranslations`, `adoptionInsightsTranslationRef` |
| `analytics-module-adoption-insights` | `PluginRoot` | `src/legacy.ts` | `analyticsApiExtensions`: `AdoptionInsightsAnalyticsApi` |

## Why it exists

The VeeCode 3.x portal runs Backstage 1.54.9 on the old frontend system. It
loads plugins through Scalprum and mounts the components, APIs and
translations that a legacy `createPlugin` plugin exports.

At `960c52c` (version 1.0.4), the default entry of both plugins is a
new-frontend-system entry, and neither `package.json` has a `scalprum` key.
rhdh-cli 1.11.2 then defaults to `PluginRoot: ./src/index.ts`. The
`adoption-insights` plugin has `.` at `./src/index.tsx`, so its export fails
with `Can't resolve './src/index.ts'`. The analytics module has `.` at
`./src/index.ts`, so its export succeeds, and `PluginRoot` is the new frontend
system entry instead of `src/legacy.ts`, where `AdoptionInsightsAnalyticsApi`
lives. In that case the portal does not fail on a name it cannot find. It logs
a console warning (`Plugin <scope> is not configured properly:
PluginRoot.AdoptionInsightsAnalyticsApi not found, ignoring analyticsApi:
...`), and the analytics provider is not registered.

## Check on a source bump

1. Confirm that each `package.json` at the new ref still has a `./legacy`
   export that points at `src/legacy.ts`. If upstream removed it, the overlay
   cannot work, and the workspace has to stay on the last ref that has it.
2. After the export, confirm that `PluginRoot` and `Alpha` export every name
   that the metadata uses (the table above). The root `CLAUDE.md` section
   "Frontends for the VeeCode 3.x portal" describes how to read the exports.
3. Keep each `name` equal to the key under `dynamicPlugins.frontend` in the
   metadata.

A published per-plugin tag (`bs_<backstage>__<version>`) is immutable: the
publish skips the push with a notice when the tag exists, and the job still
passes. A build that exposes the wrong entry needs a new plugin version, or the
ADR-008 exception path (`.github/workflows/delete-plugin-tags.yaml`), which
deletes the tag and records the decision.
