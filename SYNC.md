# Syncing with Upstream RHDH

The fork is **upstream/main + a product delta** — not a divergent merge line.
Every sync is a re-baseline onto a fresh `upstream/main`, then the delta is
re-applied from the manifest, not re-negotiated conflict-by-conflict.

The three pieces of the process:

1. **`product-delta-manifest.md`** (in the planning repo,
   `devportal-planning/research/export-overlays-alignment/`) — the contract:
   exactly which files/workspaces are VeeCode-only and must survive every sync.
2. **`scripts/fork-retarget-metadata.py`** — the mechanical step: rewrites every
   `dynamicArtifact` to `oci://quay.io/veecode/<ws>:bs_<line>!<pkg>` (idempotent,
   `--check` mode for CI).
3. **The judgement list** (manifest §7) — the irreducible manual residue:
   ~17 metadata files where the fork carries runtime-verified content.

## Sync process

### 1. Sync export-utils

```bash
cd devportal-plugin-export-utils
git fetch upstream
git merge upstream/main
# Unlikely to conflict — we do not modify utils much
git push origin main
```

### 2. Re-baseline export-overlays

```bash
cd devportal-plugin-export-overlays
git fetch upstream
git checkout -b align/upstream-<sha> upstream/main   # new base = upstream, untouched
# 1. Take upstream's versions.json as-is (stop diverging):
#    backstage/node/cli come from upstream's own file.
#    (see user-guide/05-version-updates.md for what the fields mean)
# 2. Re-apply the product delta per product-delta-manifest.md:
#    - Tier 1: the 9 fork-only workspaces
#    - Tier 2: the ~27 overlays/patches/metadata inside shared workspaces
#    - Tier 3: the root files (quay publish pipeline + CODEOWNERS + docs);
#      take upstream's catalog-index/coverage scripts back inert — do NOT
#      re-apply our divergences there
# 3. Drop the anti-delta: workspaces/*/backstage.json from the aborted
#    migration, codedb.snapshot, .fullsend/ (see manifest §4)
# 4. Re-derive the disable policy against upstream's current workspace set
#    (new workspaces: KEEP public-ecosystem, DISABLE Red-Hat-specific)
# 5. Run the retarget script:
#    python3 scripts/fork-retarget-metadata.py
#    python3 scripts/fork-retarget-metadata.py --check   # must be clean
# 6. Resolve the judgement files (manifest §7) one by one
git push origin align/upstream-<sha>
```

### 3. Prove and publish

- A single workspace can be RC-published from the align branch:
  `Publish DevPortal Dynamic Plugin Images` with `workspace-path` +
  `rc-tag-suffix` — the branch's `versions.json` decides the target line, so
  the align branch (1.52.0) is the correct base for a candidate.
- Full fleet re-export only after the native-smoke gate is green with
  `catalogPlugin` in the harness `coreFeatures` (see gate §5 of
  `alignment-decision.md`).
