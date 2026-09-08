# Dormant patches — genai

These patches are **not applied**. `override-sources.sh` only globs
`<overlay-root>/patches/*.patch` (`find … -maxdepth 1 -name "*.patch"`), so
anything under `patches-dormant/` is inert. They are parked here so the two
dynamic-export blockers found while the fork existed are not lost when the fork
is retired (ADR-011).

## Base

- Applies onto `awslabs/backstage-plugins-for-aws` @
  `b492f5659d9f1a8c324ff2ff7fde1ca9253c43f7` — the ref this workspace's
  `source.json` pins.
- Generated as `git diff b492f5659d9f1a8c324ff2ff7fde1ca9253c43f7 cf408c11de0a6819beca3cab7dbf5c4f3c2148f6`
  in the retired `veecode-platform/backstage-plugins-for-aws` fork, i.e. they
  replay the fork's genai deltas onto upstream.
- `diff --git` headers, so `override-sources.sh` applies them with `-p1`.

## Why they exist

Neither fix is present upstream, and both break `export-dynamic` for the genai
plugins:

- `0001-genai-sqlite-dynamic-import.patch` — `LangGraphReactAgentType.ts` imports
  `SqliteSaver` from `@langchain/langgraph-checkpoint-sqlite` statically. The
  native `better-sqlite3` dependency is dragged into the bundle even when the
  deployment uses Postgres. Moved to an `await import()` inside the
  `client === 'better-sqlite3'` branch.
- `0002-genai-mcpservice-relative-packagejson.patch` — `McpService.ts` imports
  `version` from `@aws/genai-plugin-for-backstage-backend/package.json`, i.e. the
  package refers to itself by name. That self-reference does not resolve inside
  the exported dynamic bundle. Replaced with a relative `../../package.json`
  import.

## Activation

genai is not exported by this workspace (the `plugins/genai/*` entries in
`plugins-list.yaml` are commented out). If it ever is:

```bash
git mv workspaces/backstage-plugins-for-aws/patches-dormant/000*.patch \
       workspaces/backstage-plugins-for-aws/patches/
```

`patches/` already exists and already holds
`0001-workspaces-exclude-dist-dynamic.patch`. These two files have distinct
names, so nothing is overwritten — but `override-sources.sh` applies
`patches/*.patch` in `sort` order, so check the resulting order before assuming
it. Renumber if a genai patch ever has to land before the glob fix.

Then re-check the patches against the `source.json` ref in force at that time — a
`repo-ref` bump can make either hunk fail to apply, and a failing patch fails the
export.
