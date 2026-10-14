# Global header stays on 3.1.x

This workspace pins `@red-hat-developer-hub/backstage-plugin-global-header` at
3.1.0 (`a28e359` in `redhat-developer/rhdh-plugins`), the last version that has
a legacy entry. `plugins/global-header/scalprum-config.json` exposes that entry
to the 3.x portal.

| Module | Source file | Used by |
| --- | --- | --- |
| `PluginRoot` | `src/legacy.ts` | `mountPoints`: `GlobalHeader`, `CompanyLogo`, `SearchComponent`, `Spacer`, `HeaderIconButton`, `StarredDropdown`, `ApplicationLauncherDropdown`, `MenuItemLink`, `HelpDropdown`, `SupportButton`, `NotificationButton`, `Divider`, `ProfileDropdown`, `LogoutButton`; `translationResources`: `globalHeaderTranslations`, `globalHeaderTranslationRef` |

The metadata names only `PluginRoot`, and `package.json` at this ref has no
`scalprum` key, so the overlay has no `Legacy` or `Alpha` module.
`repo-backstage-version` 1.54.6 is the version in `backstage.json` of the source
workspace at `a28e359`. The export fails when the two differ.

## Why it stays on 3.1.x

The VeeCode 3.x portal runs Backstage 1.54.9 on the old frontend system. It
loads plugins through Scalprum and mounts the components, APIs and
translations that a legacy `createPlugin` plugin exports.

Upstream 3.2.0 removed the `./legacy` subpath export and the legacy frontend
system plugin implementation (changeset `2ec9351` in the upstream
`CHANGELOG.md`). The `exports` of `package.json` have `"./legacy":
"./src/legacy.ts"` at 3.1.0 and no `./legacy` at 3.2.0. A 3.2.0 build has no
legacy file for an overlay to expose. rhdh-cli 1.11.2 would expose the default
entry, which is a new-frontend-system entry, as `PluginRoot`. The portal would
log a console warning for each name above (`Plugin <scope> is not configured
properly: PluginRoot.GlobalHeader not found, ignoring mountPoint: ...`), and
the header would silently not render.

## What would allow a move

Raise `repo-ref` past 3.1.x only when one of these holds:

- The 3.x portal loads new-frontend-system plugins, so the default entry
  mounts without a legacy file.
- An upstream release has a legacy entry again, and `scalprum-config.json` can
  point at it.

`update-plugins-repo-refs.yaml` can open a bump PR for this workspace. Do not
merge it unless one of the two holds.

## Check on a source bump within 3.1.x

1. Confirm that `package.json` at the new ref still has a `./legacy` export
   that points at `src/legacy.ts`.
2. After the export, confirm that `PluginRoot` exports every name in the table.
   The root `CLAUDE.md` section "Frontends for the VeeCode 3.x portal"
   describes how to read the exports.
3. Keep `name` equal to the key under `dynamicPlugins.frontend` in the
   metadata.

A published per-plugin tag (`bs_<backstage>__<version>`) is immutable: the
publish skips the push with a notice when the tag exists, and the job still
passes. A build that exposes the wrong entry needs a new plugin version, or the
ADR-008 exception path (`.github/workflows/delete-plugin-tags.yaml`), which
deletes the tag and records the decision.
