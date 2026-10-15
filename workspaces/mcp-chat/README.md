# MCP Chat overrides

This workspace exports `@backstage-community/plugin-mcp-chat` 0.6.0 and `@backstage-community/plugin-mcp-chat-backend` 0.8.0 from source `5457d02f7` (Backstage 1.49.2). They are published as `bs_1.54.9__0.6.0` and `bs_1.54.9__0.8.0`, for the VeeCode 3.x portal, which runs Backstage 1.54.9 on the old frontend system.

Three overrides apply to the export:

| Override | File | Effect |
| --- | --- | --- |
| Backend overlay | `plugins/mcp-chat-backend/overlay/src/` (6 files) | Replaces the upstream backend files. Adds the per-user authorization header for MCP servers (`getRuntimeAuthorizationHeader`), retry with backoff (`scheduleRetry`), and the gpt-5 request options for OpenAI (`max_completion_tokens`, `parallel_tool_calls`). |
| Frontend entry | `plugins/mcp-chat/scalprum-config.json` | Exposes `./src/index.ts` as `PluginRoot`. At this ref that file is the legacy `createPlugin` entry, and it exports `McpChatPage` and `MCPChatIcon`, the names the metadata uses. |
| Patch | `patches/1-proxy-addr-2.0.8.patch` | Moves `proxy-addr` from 2.0.7 to 2.0.8 in `yarn.lock` (CVE-2026-90711, critical). Without it, the backend embeds 2.0.7. |

## Check on a source bump

1. `override-sources.sh` copies each overlay file over the upstream file whole. Before moving `repo-ref`, re-roll the overlay files against the new upstream, or upstream changes to them are lost without a conflict.
2. Confirm that `./src/index.ts` still exports the legacy entry and that `PluginRoot` exports every name in the table above.
3. Remove the patch once the source's `yarn.lock` resolves `proxy-addr` to 2.0.8 or later.
