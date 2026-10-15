# Tech Radar: frontend override and patch

This workspace builds the Tech Radar frontend and backend from `backstage/community-plugins` at ref `30d41d076219242a62e7f997dc9190f7b5f21f60`. RHDH pins this ref on its 1.54 line. `source.json` sets `repo-backstage-version` to 1.54.5 to match the upstream `backstage.json` at that ref.

The VeeCode 3.x portal runs Backstage 1.54.9 on the old frontend system and loads plugins through Scalprum. It needs a legacy entry exposed as `PluginRoot`. The override below exposes it.

## Frontend override

`plugins/tech-radar/scalprum-config.json` replaces the package's Scalprum config and exposes two modules:

| Module | Source file | Purpose |
| --- | --- | --- |
| `PluginRoot` | `./src/index.ts` (overlay at `plugins/tech-radar/overlay/src/index.ts`) | Legacy entry. It re-exports the `createPlugin` plugin from `src/plugin.ts`. The metadata's `appConfigExamples` names `TechRadarPage` and `TechRadarIcon` as its exports. |
| `alpha` | `./src/alpha.tsx` (upstream file) | New frontend system module. The 3.x portal runs the old frontend system and does not load it. |

The overlay replaces the upstream `src/index.ts` and changes it in two ways:

- It drops the deprecated `Router` export (`export const Router = RadarPage` upstream). The metadata does not name it.
- It adds `TechRadarIcon`, re-exported from `@material-ui/icons/MyLocation`. The metadata's `appIcons` names it.

## Patch

The workspace applies one patch, `patches/1-proxy-addr-2.0.8.patch`.

`1-proxy-addr-2.0.8.patch` raises `proxy-addr` from 2.0.7 to 2.0.8 (CVE-2026-90711) in `yarn.lock`. It stays because `workspaces/tech-radar/yarn.lock` at `30d41d076` still resolves `proxy-addr@npm:~2.0.7` to 2.0.7 (lines 27036-27043 at that ref). The patch applies to that file, not to the monorepo root lock. The patch header records the removal condition: remove the patch when `source.json` moves to a ref whose lock resolves `proxy-addr` 2.0.8 or later.

`1-jest-30-workspace-devdeps.patch` is not used at this ref. It added jest 30 and jsdom devDependencies to the tech-radar `package.json`, and that file at `30d41d076` already declares them (`workspaces/tech-radar/package.json` lines 46-50), so the patch has nothing left to add.

## Check on the next source bump

1. Compare the upstream `src/index.ts` at the new ref with the overlay. The overlay replaces the whole file, so a new export in upstream `src/index.ts` is missing from the build unless you copy it into the overlay.
2. After the export, open `dist-dynamic/dist-scalprum/plugin-manifest.json`, then the container entry it names. Confirm that the chunk for `PluginRoot` exports every `importName` the portal resolves today (`TechRadarPage` and `TechRadarIcon`; `TechRadarApi` is the known gap below). Confirm that every export of `src/index.ts` is in that chunk too.
3. Confirm that `src/alpha.tsx` still exists at the new ref, because `scalprum-config.json` names it.
4. Remove `1-proxy-addr-2.0.8.patch` when `workspaces/tech-radar/yarn.lock` at the new ref resolves `proxy-addr` 2.0.8 or later.

## Known gap

The default configuration no longer names `apiFactories`, because the face does not carry it. At this ref, `src/api.ts:41` exports `TechRadarApi` only as a TypeScript interface. Compilation erases it, so the built `PluginRoot` chunk has no runtime binding for it, and a configuration that names `TechRadarApi` in `apiFactories` cannot resolve it. This workspace does not fix the gap.
