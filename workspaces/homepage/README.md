# Dynamic Home Page frontend entry

`plugins/dynamic-home-page/scalprum-config.json` exposes the frontend of
`@red-hat-developer-hub/backstage-plugin-dynamic-home-page` to the 3.x portal.
The package has no inline `scalprum` key at the pinned ref `b2110290c`, so
this file is the only place that names its Scalprum modules.

| Module | Source file | Used by |
| --- | --- | --- |
| `PluginRoot` | `src/index.ts` | `dynamicRoutes`: `DynamicHomePage`; `mountPoints`: `VisitListener`, `OnboardingSection`, `EntitySection`, `TemplateSection`, `QuickAccessCard`, `SearchBar`, `CatalogStarredEntitiesCard`, `RecentlyVisitedCard`, `TopVisitedCard`, `FeaturedDocsCard`, `JokeCard` |
| `Alpha` | `src/translations/index.ts` | `translationResources`: `homepageTranslations`, `homepageTranslationRef` |
| `dynamicHomePagePlugin` | `src/index.ts` | no name in `appConfigExamples` |

## Why it exists

The VeeCode 3.x portal runs Backstage 1.54.9 on the old frontend system. It
loads plugins through Scalprum and mounts the components and translations that
a legacy `createPlugin` plugin exports.

At `b2110290c`, `src/index.ts` re-exports `./plugin` (line 23), and
`src/plugin.ts` defines the legacy entry `dynamicHomePagePlugin` with
`createPlugin` (line 80). The override pins `PluginRoot` to that file and
declares `Alpha` for the translations that the metadata names with
`module: Alpha`. A name the portal cannot find is not an error. The portal logs
`Plugin <scope> is not configured properly` in the browser console and skips
that mount point, so the cards silently do not render.

## Check on a source bump

1. At the new ref, `plugins/dynamic-home-page/src/index.ts` must still re-export
   a legacy `createPlugin` entry. If upstream makes it a `createFrontendPlugin`
   entry, this override exposes the wrong entry. Keep the workspace on the last
   ref that has the legacy entry.
2. `src/translations/index.ts` must still export `homepageTranslations` and
   `homepageTranslationRef`.
3. After the export, confirm that `PluginRoot` and `Alpha` export every name in
   the table. The root `CLAUDE.md` section "Frontends for the VeeCode 3.x
   portal" describes how to read the exports.
4. Keep `name` equal to the key under `dynamicPlugins.frontend` in the
   metadata: `red-hat-developer-hub.backstage-plugin-dynamic-home-page`.
