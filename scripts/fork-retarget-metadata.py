#!/usr/bin/env python3
"""fork-retarget-metadata.py — the WS-EXPORT metadata sync rule (manifest §6).

Rewrites every `dynamicArtifact` in workspaces/*/metadata/*.yaml to the fork
shape on every upstream sync, turning ~112 mechanical conflict resolutions
into one script run.

    upstream: oci://ghcr.io/redhat-developer/rhdh-plugin-export-overlays/<pkg>:bs_<line>__<ver>[!<pkg>]
    fork:     oci://quay.io/veecode/<workspace>:bs_<line>!<pkg>

Rules
-----
* `<line>` is the `backstage` value from `versions.json` (e.g. 1.52.0 -> bs_1.52.0).
* `<pkg>` (the `!` selector) derives from `spec.packageName`:
  strip the leading `@`, replace `/` with `-`. Verified against existing refs:
  `@aws/amazon-ecs-plugin-for-backstage-backend` -> `aws-amazon-ecs-plugin-for-backstage-backend`.
* Third-party refs — anything NOT under ghcr.io/redhat-developer/rhdh-plugin-export-overlays
  or quay.io/veecode (e.g. oci://quay.io/redhat-resource-optimization/...) — are
  left untouched: they are direct references to an external publisher's image.
* Idempotent: running twice produces no diff.

Only the `dynamicArtifact:` line is rewritten; comments and formatting in the
rest of the file are preserved (text-line edit, not a YAML round-trip).

Usage:
    python3 scripts/fork-retarget-metadata.py            # rewrite in place
    python3 scripts/fork-retarget-metadata.py --check    # exit 1 if any change needed
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSIONS_JSON = ROOT / "versions.json"
WORKSPACES = ROOT / "workspaces"

UPSTREAM_PREFIX = "oci://ghcr.io/redhat-developer/rhdh-plugin-export-overlays/"
FORK_PREFIX = "oci://quay.io/veecode/"
PKG_RE = re.compile(r'''^\s*packageName:\s*['"]([^'"]+)['"]''')
ARTIFACT_RE = re.compile(r'''^(\s*dynamicArtifact:\s*)(['"]?)([^\s'"]+)\2(\s*)$''')

CHECK = "--check" in sys.argv


def target_line() -> str:
    data = json.loads(VERSIONS_JSON.read_text())
    version = data["backstage"]
    return f"bs_{version}"


def selector(package_name: str) -> str:
    return package_name.lstrip("@").replace("/", "-")


def rewrite_ref(ref: str, workspace: str, line: str, pkg: str) -> str | None:
    """Return the fork-shaped ref, or None if this ref must not be touched."""
    if ref.startswith(UPSTREAM_PREFIX) or ref.startswith(FORK_PREFIX):
        return f"oci://quay.io/veecode/{workspace}:{line}!{pkg}"
    return None  # third-party / external publisher: leave alone


def main() -> int:
    line = target_line()
    files = sorted(WORKSPACES.glob("*/metadata/*.yaml"))

    # Pass 1: collect each file's packageName (order-independent).
    pkg_names = {}
    for path in files:
        for raw in path.read_text().splitlines():
            pm = PKG_RE.match(raw)
            if pm:
                pkg_names[path] = pm.group(1)

    # Pass 2: rewrite the dynamicArtifact line, preserving quotes/trailing.
    changed = 0
    for path in files:
        pkg_name = pkg_names.get(path)
        if pkg_name is None:
            continue
        new_lines = []
        file_changed = False
        for raw in path.read_text().splitlines(keepends=True):
            am = ARTIFACT_RE.match(raw)
            if am:
                old_ref = am.group(3)
                new_ref = rewrite_ref(old_ref, path.parent.parent.name, line, selector(pkg_name))
                if new_ref is not None and new_ref != old_ref:
                    raw = f"{am.group(1)}{am.group(2)}{new_ref}{am.group(2)}{am.group(4)}"
                    file_changed = True
                    if not CHECK:
                        print(f"{path}: {old_ref}  ->  {new_ref}")
            new_lines.append(raw)
        if file_changed:
            changed += 1
            if CHECK:
                print(f"{path}: would change")
            else:
                path.write_text("".join(new_lines))

    print(f"{changed} metadata files with dynamicArtifact rewritten (target {line}).")
    return 1 if CHECK and changed else 0


if __name__ == "__main__":
    sys.exit(main())
