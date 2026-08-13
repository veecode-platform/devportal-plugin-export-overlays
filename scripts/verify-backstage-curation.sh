#!/usr/bin/env bash
# verify-backstage-curation.sh — guard the fork's curated export scope for the
# backstage workspace.
#
# WHY: workspaces/backstage/plugins-list.yaml is deliberately curated down to 5
# entries (PR #166). The export step costs ~28s per enabled entry, so the full
# upstream list (101 entries) turns this job from ~6 min into ~1h on every
# publish — the fleet's critical path and a large GH Actions minutes burn.
# Re-baselines and bulk edits have silently restored the full list; this guard
# fails loudly when that happens.
#
# The adoption criterion (from the file itself): an entry stays enabled only if
# it has a workspaces/backstage/metadata/*.yaml (reaches the Extensions catalog)
# or a consumer config references its OCI ref (devportal-platform presets,
# devportal-distro, devportal-samples).
#
# To deliberately adopt an additional entry: add it to EXPECTED below AND add a
# metadata/*.yaml for it (or point to its consumer). Then bump the count.
set -uo pipefail

LIST="workspaces/backstage/plugins-list.yaml"
MAX_ENABLED=5

# The deliberately-adopted set (each has metadata/*.yaml or a consumer ref).
EXPECTED=(
  "plugins/kubernetes"
  "plugins/mcp-actions-backend"
  "plugins/events-backend-module-gitlab"
  "plugins/scaffolder-backend-module-gerrit"
  "plugins/notifications-backend-module-email"
)

if [ ! -f "$LIST" ]; then
  echo "FAIL: $LIST not found (curation lost or tree moved)"
  exit 1
fi

# enabled entries = lines that start a plugins/ or packages/ path (not commented)
enabled=$(grep -E "^(plugins/|packages/)" "$LIST")
count=$(printf '%s\n' "$enabled" | grep -c .)

if [ "$count" -gt "$MAX_ENABLED" ]; then
  echo "FAIL: backstage plugins-list has $count enabled entries (max $MAX_ENABLED)."
  echo "The curated export scope was lost — restore it from main (see PR #166) or"
  echo "deliberately adopt each new entry (add metadata + bump MAX_ENABLED)."
  echo "--- enabled entries now: ---"
  printf '%s\n' "$enabled"
  exit 1
fi

for e in "${EXPECTED[@]}"; do
  if ! printf '%s\n' "$enabled" | grep -q "^${e}:"; then
    echo "FAIL: expected curated entry '$e' is not enabled."
    echo "The curated export scope was lost — restore it from main (see PR #166)."
    exit 1
  fi
done

# sanity: the curated header/sections should still be present (file was not
# wholesale replaced by upstream's)
if ! grep -q "Adoption criterion" "$LIST"; then
  echo "WARN: curated header not found — file may have been replaced by upstream's"
  exit 1
fi

echo "PASS: backstage plugins-list is curated ($count enabled, all ${#EXPECTED[@]} expected present)"
