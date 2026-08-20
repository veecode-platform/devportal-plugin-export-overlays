#!/bin/bash
#
# Assembles the complete catalog index by copying Package entity YAMLs
# from workspaces/*/metadata/ into catalog-entities/extensions/packages/,
# generating the all.yaml Location manifest, and (Option D step 1)
# regenerating catalog-entities/dynamic-plugins.default.yaml with a real,
# digest-pinned index — see scripts/generate-dpdy-index.sh. That file stays
# a committed stub in git; this only overwrites it in the working tree.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGES_DIR="$REPO_ROOT/catalog-entities/extensions/packages"

echo "Assembling catalog index..."

# Clean and recreate packages directory
rm -rf "$PACKAGES_DIR"
mkdir -p "$PACKAGES_DIR"

# Copy all metadata YAMLs from workspaces
count=0
for metadata_file in "$REPO_ROOT"/workspaces/*/metadata/*.yaml; do
  [ -f "$metadata_file" ] || continue
  cp "$metadata_file" "$PACKAGES_DIR/"
  count=$((count + 1))
done

echo "Copied $count package YAMLs to $PACKAGES_DIR"

# Generate all.yaml Location manifest
cat > "$PACKAGES_DIR/all.yaml" <<'HEADER'
apiVersion: backstage.io/v1alpha1
kind: Location
metadata:
  namespace: rhdh
  name: packages
spec:
  targets:
HEADER

# Add each YAML file (excluding all.yaml itself) sorted alphabetically
for f in $(ls "$PACKAGES_DIR"/*.yaml | sort); do
  basename="$(basename "$f")"
  [ "$basename" = "all.yaml" ] && continue
  echo "    - ./$basename" >> "$PACKAGES_DIR/all.yaml"
done

total=$(grep -c '^\s*-' "$PACKAGES_DIR/all.yaml")
echo "Generated all.yaml with $total package entries"

# Regenerate dynamic-plugins.default.yaml with real, digest-pinned entries
# (Option D step 1). Requires network + skopeo; that's guaranteed in CI but
# not for local dry-runs, hence the separate script's --no-digest escape
# hatch (not used here).
bash "$REPO_ROOT/scripts/generate-dpdy-index.sh"

echo "Catalog index assembly complete."
