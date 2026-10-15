# Extensions legacy entry

`plugins/extensions/scalprum-config.json` exposes the frontend of
`@red-hat-developer-hub/backstage-plugin-extensions` to the 3.x portal.

| Module | Source file | Used by |
| --- | --- | --- |
| `PluginRoot` | `./src/index.ts` | `dynamicRoutes`: `DynamicExtensionsPluginRouter` at `/extensions`; `appIcons`: `PluginsIcon` |
| `Alpha` | `./src/alpha/translations/index.ts` | `translationResources`: `extensionsTranslations`, `extensionsTranslationRef` |

## Why it exists

The VeeCode 3.x portal runs Backstage 1.54.9 on the old frontend system. It
loads plugins through Scalprum and mounts the routes, components and
translations that a legacy `createPlugin` plugin exports.

At the pinned source ref (`source.json`), `./src/index.ts` is the legacy
`createPlugin` entry. The metadata names the `Alpha` module for the
translations, and that module is not exposed without this file. The portal
does not fail. It logs a `not configured properly` warning for each name it
cannot find.

## Check on a source bump

1. Confirm that `./src/index.ts` at the new ref is still a legacy
   `createPlugin` entry. If upstream has no legacy entry, keep the workspace
   on the last ref that has one.
2. Confirm that `./src/alpha/translations/index.ts` exists and exports
   `extensionsTranslations` and `extensionsTranslationRef`.
3. After the export, open `dist-dynamic/dist-scalprum/plugin-manifest.json`,
   then the container entry that `loadScripts` names. Confirm that `PluginRoot`
   and `Alpha` export every name in the table above. The root `CLAUDE.md`
   section "Frontends for the VeeCode 3.x portal" describes how to read the
   exports.
4. Keep `name` equal to the key under `dynamicPlugins.frontend` in the
   metadata.

The 1.x line of the plugin uses `./src/legacy.ts` and `./src/alpha/index.tsx`
instead. A move to that line changes this file, so it needs its own check.
