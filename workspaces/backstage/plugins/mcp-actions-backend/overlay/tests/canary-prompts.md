# Canary Prompts — MCP Knowledge Layer v0

Test spec for the `explain(concept)` MCP action registered by patch
`workspaces/backstage/patches/3-register-explain-knowledge-action.patch`.
Not shipped at runtime — this file lives in `overlay/tests/` and is not
compiled into `dist/`.

Format: `prompt → must contain X, Y; must NOT contain Z`.
Binary oracle: each response is evaluated against the lists below. Any "must NOT contain" hit = hard fail. Any missing "must contain" = soft fail (tune the concept card or the router).

v0 corpus covers 4 concepts: `scaffolder`, `template`, `catalog`, `plugin` — defined in `overlay/src/actions/knowledge.ts`. Each card ends with a pointer to `docs.platform.vee.codes`.

---

## Base (5)

### 1. "what is the scaffolder?"
- **Must contain:** mechanism that executes templates; built-in Backstage plugin; orchestrates actions (fetch, publish, register); pointer to VeeCode docs
- **Must NOT contain:** conflate with template; invent APIs/commands; claim it "generates code on its own"

### 2. "what is a template?"
- **Must contain:** declarative YAML definition (`template.yaml`); has parameters (input) and steps/actions; consumed by the scaffolder
- **Must NOT contain:** call the template a "generated project"; treat it as directly executable code

### 3. "what is the relationship between template and scaffolder?"
- **Must contain:** template = declarative definition; scaffolder = executor; explicit input→output relationship
- **Must NOT contain:** treat them as synonyms; invert the relationship

### 4. "what is the catalog?"
- **Must contain:** registry of entities (Component, System, API, Resource, Location); `catalog-info.yaml`; software graph
- **Must NOT contain:** conflate with a package registry (npm/maven); describe it as a "generic database"

### 5. "how do I add a plugin?"
- **Must contain:** frontend/backend distinction; reference to `app-config.yaml` and/or dynamic plugin registration; pointer to VeeCode docs
- **Must NOT contain:** fictional CLI command; omit the frontend/backend distinction

---

## Variants (5)

### 6. Beginner/vague — "what is this Backstage thing?"
- **Must contain:** open-source platform for developer portals; one-paragraph framing; invitation to ask a more specific question about one of the 4 concepts
- **Must NOT contain:** dump all concepts at once; unexplained jargon (e.g. "IDP", "SDLC")

### 7. Partial — "does the scaffolder need a plugin?"
- **Must contain:** clarify that the scaffolder IS already a built-in plugin; custom actions can come from additional plugins
- **Must NOT contain:** evasive "it depends"; plain yes/no without disambiguating

### 8. Wrong (honesty) — "how does the scaffolder use Kubernetes to generate a project?"
- **Must contain:** explicit correction of the premise (scaffolder does not depend on K8s to generate); explain the actual flow via actions; offer the correct concept
- **Must NOT contain:** invent a K8s flow to validate the premise; tacitly agree with something false

### 9. Ambiguous — "how do I configure it?"
- **Must contain:** clarification request; list the branches (plugin / template / catalog / instance) as possible options
- **Must NOT contain:** arbitrarily pick one topic; dump config for all of them without asking

### 10. Out of scope — "what is the difference between Backstage and Port.io?"
- **Must contain:** honest admission that v0 covers only the 4 base concepts; suggestion to consult external docs for the comparison
- **Must NOT contain:** invent a comparison; assert pros/cons without support from the corpus

---

## Validation protocol

Each prompt is what a user would type in a chat client (Claude Code, Cursor, etc.) that has the patched `mcp-actions-backend` active. The canary test is **end-to-end**: the client LLM decides whether/how to call `explain(concept)`, the action returns router content + the relevant card, the LLM produces a final user-facing reply. The oracle evaluates that final reply — not the raw tool output.

1. Issue the prompt to the client LLM with the MCP server active (`explain` tool discoverable alongside the existing `fetch-template-metadata`, `execute-template`, etc.).
2. Let the LLM choose which `concept` to pass (or no tool call at all) — do not manually route. The contract in the router content (see `knowledge.ts#ROUTER_MD`) is what we are validating.
3. Evaluate the LLM's final reply against `must contain` and `must NOT contain`.
4. Outcome: **pass** (all "must" hits, no "must NOT" hits) / **fail** (any "must NOT" hit) / **tune** (missed a "must" but did not violate a "must NOT").
5. Exit criterion: ≥8/10 pass, 0 fail. "Tune" prompts become refinement tickets for the corresponding card or for the router.
