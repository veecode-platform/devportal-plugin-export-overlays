# App defaults stay on 0.0.2

This workspace builds `@red-hat-developer-hub/backstage-plugin-app-auth` and
`@red-hat-developer-hub/backstage-plugin-app-integrations` at 0.0.2 (`070dcf1`
in `redhat-developer/rhdh-plugins`). It has no `scalprum-config.json`, because
neither package has a legacy entry to expose.

## Why it stays on 0.0.2

The VeeCode 3.x portal runs Backstage 1.54.9 on the old frontend system. It
loads plugins through Scalprum and mounts the components, APIs and
translations that a legacy `createPlugin` plugin exports.

Both packages are new-frontend-system modules. At 0.0.2, `src/index.ts` is
`export default {}`, a stub whose comment says the plugin targets the new
frontend system only and that the public APIs live under `./alpha`. The built
`PluginRoot` exports that empty `default` and nothing else, so the portal finds
nothing to mount and the packages do nothing there. That is how the 3.0 portal
ran, and this workspace keeps it.

At 1.2.0 (`app-auth`) and 1.1.1 (`app-integrations`), the newest versions
checked, at `af35154`, `package.json` exports only `.` and `./alpha`, and
`src/` has no legacy file. A newer version would add a build that the portal
cannot use.

`source.json` keeps the ref and Backstage version of the 3.0 build (`070dcf1`,
1.49.3). `backstage.json` is 1.54.9, so the images publish as
`bs_1.54.9__0.0.2` with `supportedVersions: 1.54.9`.

## What would allow a move

Raise `repo-ref` only when one of these holds:

- A package has a `./legacy` export. Then add
  `plugins/<plugin>/scalprum-config.json` that exposes it as `PluginRoot`, as
  in the other workspaces.
- The 3.x portal loads new-frontend-system plugins, so the modules mount
  without a legacy file.

`update-plugins-repo-refs.yaml` can open a bump PR for this workspace. Do not
merge it unless one of the two holds.

## Check on a source bump

1. At the new ref, read `exports` in each `package.json` and look for
   `./legacy`.
2. After an export, confirm that `PluginRoot` exports more than `default`. The
   root `CLAUDE.md` section "Frontends for the VeeCode 3.x portal" describes
   how to read the exports.

A published per-plugin tag (`bs_<backstage>__<version>`) is immutable: the
publish skips the push with a notice when the tag exists, and the job still
passes. A build that exposes the wrong entry needs a new plugin version, or the
ADR-008 exception path (`.github/workflows/delete-plugin-tags.yaml`), which
deletes the tag and records the decision.
