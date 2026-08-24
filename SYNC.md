# Syncing with Upstream RHDH

## Upstream repos
- Utils: https://github.com/redhat-developer/rhdh-plugin-export-utils
- Overlays: https://github.com/redhat-developer/rhdh-plugin-export-overlays

## Sync process

### 1. Sync export-utils

```bash
cd devportal-plugin-export-utils
git fetch upstream
git merge upstream/main
# Resolve conflicts (unlikely — we don't modify utils much)
git push origin main
```

### 2. Sync export-overlays

```bash
cd devportal-plugin-export-overlays
git fetch upstream
git merge upstream/main
# Resolve conflicts:
#   - versions.json (reconcile PER FIELD — do NOT blindly accept upstream):
#       * backstage:   keep OURS (currently 1.49.4) — our distro target
#       * node:        keep OURS (currently 22.19.0) — our build Node version
#       * cli/cliPackage: reconcile to the export CLI OUR distro ships
#                         (currently 1.10.7 / @red-hat-developer-hub/cli).
#                         This selects the export CLI feeding
#                         export-workspaces-as-dynamic.yaml; an unintended
#                         value here breaks export/publish.
#       (see user-guide/05-version-updates.md for what these fields mean)
#   - plugins-regexps: keep our scope list
#   - .github/workflows/*: keep our org/registry references
#   - workspaces/: new workspaces will appear — categorize as KEEP or DISABLE
git push origin main
```

### 3. After sync
- Confirm `versions.json` survived the merge intact (no upstream `cli`/`node` leaked in):
  ```bash
  jq '{backstage,node,cli,cliPackage}' versions.json
  ```
- Review new workspaces added by upstream
- Check if disabled workspaces have been updated (may be worth re-evaluating)
- Run full matrix build to validate
- Fix any patch conflicts

## Frequency
Monthly or when a new RHDH release branch is created.
