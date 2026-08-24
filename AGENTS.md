# AGENTS.md

Agent-critical rules for this repository. `CLAUDE.md` is the full guide; what follows is the
subset that prevents production incidents. If you automate anything here, read both.

## The one rule that must survive every refactor

**Publishing is automatic and versioned; promotion to `:latest` is manual and human-approved.**

- Pushes to `main` / release branches auto-publish **versioned** artifacts only
  (plugin bundles, `plugin-catalog-index:bs_<version>`). That is the staging channel.
- `plugin-catalog-index:latest` is a **production pointer** consumed live by deployed
  instances (SaaS included). It moves exclusively via
  `.github/workflows/promote-catalog-index-latest.yaml` — manual dispatch, gated by the
  `catalog-latest-promotion` GitHub Environment (human approval + digest audit trail).
- **Never add a `:latest` tag/push to any automatic workflow, and never "fix" a red publish
  by re-adding it.** See CLAUDE.md § "Publish vs. promote (`:latest`)" for the incident this
  guards against.

## Scope guardrails for agents

- Do not edit `.github/workflows/publish-*.yaml` or `promote-*.yaml` without an explicit
  human request naming the file.
- Disposable POC workspaces (`workspaces/*-drydock`) are never merged to `main`; they exist
  on PR branches to publish isolated `pr_<number>__<version>` candidate tags.
- Workflow inputs must reach shell through `env:` with quoting — never interpolate
  `${{ inputs.* }}` or event payload fields directly into `run:` commands.
