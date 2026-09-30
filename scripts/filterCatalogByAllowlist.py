#!/usr/bin/env python3
#
# Keeps a generated catalog index in line with the export allowlist.
#
# generateCatalogIndex.py copies every workspaces/*/metadata/*.yaml into the
# index, so it also offers packages that are never exported. This step runs
# after update-index.sh and before the index is packed:
#
#   1. removes each Package whose workspace has no plugins-list.yaml, or whose
#      plugin line is commented out there;
#   2. drops each Plugin left with no package;
#   3. rewrites plugins/all.yaml and packages/all.yaml to match.
#
# PluginCollections that list a dropped Plugin are reported, not edited. The step
# exits 1, changing nothing, when a package file name is shared by an allowed and
# a not allowed workspace, because the flattened index file cannot be traced.

import argparse
import sys
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from generateCatalogIndex import ALL_YAML_FILENAME, regenerate_all_yaml_files
from plugin_utils import (
    Colors,
    build_workspace_mappings,
    log_debug,
    log_error,
    log_info,
    log_warn,
    read_plugins_list,
    set_debug,
)

REASON_WORKSPACE_DISABLED = "workspace disabled"
REASON_NO_ACTIVE_ENTRY = "no uncommented plugins-list entry"
REASON_NOT_IN_OVERLAYS = "not in overlays"
REASON_IMAGE_SHIPPED_LOCAL_PATH = "image-shipped local path"


@dataclass
class Allowlist:
    """Package file names (as copied into the index) the overlays allow."""

    allowed: set[str] = field(default_factory=set)
    allowed_reasons: dict[str, str] = field(default_factory=dict)
    denied: dict[str, str] = field(default_factory=dict)
    collisions: dict[str, list[str]] = field(default_factory=dict)


def load_entity(path: Path) -> dict:
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f)
    except (OSError, yaml.YAMLError):
        return {}
    return data if isinstance(data, dict) else {}


def entity_name(entity: dict, default: str = "") -> str:
    return (entity.get("metadata") or {}).get("name", default)


def build_allowlist(overlays_dir: Path) -> Allowlist:
    """Decide, for every workspaces/*/metadata/*.yaml, whether the export covers it.

    The generator flattens all workspaces into one folder by file name and keeps
    whichever copy it reads last, so a name that one workspace allows and another
    does not is a collision: the index copy cannot be traced to the allowed source.
    """
    mappings = build_workspace_mappings(overlays_dir)
    plugin_path_by_entity: dict[tuple[str, str], str] = {}
    for ws_path, stem in mappings.ws_path_to_stem.items():
        ws_name, plugin_path = ws_path.split("/", 1)
        plugin_path_by_entity[(ws_name, stem)] = plugin_path

    allowlist = Allowlist()
    sources: dict[str, list[str]] = {}
    denied_reason: dict[str, str] = {}
    for ws_dir in sorted((overlays_dir / "workspaces").iterdir()):
        metadata_dir = ws_dir / "metadata"
        if not ws_dir.is_dir() or not metadata_dir.is_dir():
            continue
        exported = (ws_dir / "plugins-list.yaml").exists()
        active_paths = set(read_plugins_list(ws_dir))
        for metadata_file in sorted(metadata_dir.glob("*.yaml")):
            entity = load_entity(metadata_file)
            dynamic_artifact = (entity.get("spec") or {}).get("dynamicArtifact")
            if isinstance(dynamic_artifact, str) and dynamic_artifact.startswith("./"):
                allowlist.allowed.add(metadata_file.name)
                allowlist.allowed_reasons[metadata_file.name] = REASON_IMAGE_SHIPPED_LOCAL_PATH
                source = metadata_file.relative_to(overlays_dir).as_posix()
                sources.setdefault(metadata_file.name, []).append(f"{source} ({REASON_IMAGE_SHIPPED_LOCAL_PATH})")
                continue

            reason = None
            if not exported:
                reason = REASON_WORKSPACE_DISABLED
            else:
                name = entity_name(entity, metadata_file.stem)
                if plugin_path_by_entity.get((ws_dir.name, name)) not in active_paths:
                    reason = REASON_NO_ACTIVE_ENTRY
            source = metadata_file.relative_to(overlays_dir).as_posix()
            if reason is None:
                allowlist.allowed.add(metadata_file.name)
                sources.setdefault(metadata_file.name, []).append(f"{source} (allowed)")
            else:
                denied_reason.setdefault(metadata_file.name, reason)
                sources.setdefault(metadata_file.name, []).append(f"{source} ({reason})")

    allowlist.denied = {n: r for n, r in denied_reason.items() if n not in allowlist.allowed}
    allowlist.collisions = {n: sources[n] for n in allowlist.allowed if n in denied_reason}
    return allowlist


def package_refs(plugin: dict) -> list[str]:
    """Package names a Plugin lists; a ref is a name or a ``{name: ...}`` mapping."""
    refs = (plugin.get("spec") or {}).get("packages") or []
    return [ref.get("name") if isinstance(ref, dict) else ref for ref in refs]


def index_files(directory: Path) -> list[Path]:
    return sorted(f for f in directory.glob("*.yaml") if f.name != ALL_YAML_FILENAME)


def count_by_reason(reasons: list[str]) -> str:
    return ", ".join(f"{reason}: {reasons.count(reason)}" for reason in sorted(set(reasons))) or "none"


def filter_catalog(overlays_dir: Path, catalog_dir: Path) -> None:
    extensions_dir = catalog_dir / "catalog-entities" / "extensions"
    packages_dir = extensions_dir / "packages"
    plugins_dir = extensions_dir / "plugins"
    collections_dir = extensions_dir / "collections"
    if not (overlays_dir / "workspaces").is_dir():
        log_error(f"No workspaces/ directory in overlays dir: {overlays_dir}")
        sys.exit(1)
    if not packages_dir.is_dir():
        log_error(f"Not a generated catalog index, packages/ is missing: {packages_dir}")
        sys.exit(1)

    allowlist = build_allowlist(overlays_dir)
    for name, sources in sorted(allowlist.collisions.items()):
        log_error(f"{name} is shared by an allowed and a not allowed workspace: {'; '.join(sources)}")
    if allowlist.collisions:
        log_error("The generator keeps whichever copy it reads last, so the index may carry the one the export "
                  "does not cover. Remove or rename the not allowed copy. Nothing was changed.")
        sys.exit(1)

    packages = index_files(packages_dir)
    removed_packages = [f for f in packages if f.name not in allowlist.allowed]
    if packages and len(removed_packages) == len(packages):
        log_error(f"The overlays allow none of the {len(packages)} packages in the index; "
                  f"is --overlays-dir ({overlays_dir}) the right checkout? Nothing was changed.")
        sys.exit(1)

    kept_packages = [f for f in packages if f.name in allowlist.allowed]
    kept_names = {entity_name(load_entity(f), f.stem) for f in kept_packages}
    removed_names = {entity_name(load_entity(f), f.stem) for f in removed_packages} - kept_names
    reasons = []
    for package_file in removed_packages:
        reason = allowlist.denied.get(package_file.name, REASON_NOT_IN_OVERLAYS)
        reasons.append(reason)
        log_debug(f"Remove package {package_file.name} ({reason})")
        package_file.unlink()

    kept_reasons = [
        allowlist.allowed_reasons[package_file.name]
        for package_file in kept_packages
        if package_file.name in allowlist.allowed_reasons
    ]
    kept_reason_summary = f" ({count_by_reason(kept_reasons)})" if kept_reasons else ""

    plugin_files = index_files(plugins_dir) if plugins_dir.is_dir() else []
    dropped_names: set[str] = set()
    dropped_count = 0
    without_package = 0
    for plugin_file in plugin_files:
        plugin = load_entity(plugin_file)
        refs = package_refs(plugin)
        has_package = any(ref in kept_names for ref in refs)
        if not has_package and any(ref in removed_names for ref in refs):
            log_debug(f"Remove plugin {plugin_file.name}: all its packages left")
            dropped_names.add(entity_name(plugin, plugin_file.stem))
            dropped_count += 1
            plugin_file.unlink()
        elif refs and not has_package:
            without_package += 1

    for collection_file in index_files(collections_dir) if collections_dir.is_dir() else []:
        listed = (load_entity(collection_file).get("spec") or {}).get("plugins") or []
        for plugin_name in sorted(dropped_names.intersection(p for p in listed if isinstance(p, str))):
            log_warn(f"Collection {collection_file.name} lists dropped plugin {plugin_name}")

    regenerate_all_yaml_files(catalog_dir)

    log_info(
        f"Removed {len(removed_packages)} package(s) ({count_by_reason(reasons)}), "
        f"kept {len(kept_packages)}{kept_reason_summary}"
    )
    log_info(f"Removed {dropped_count} plugin(s) left with no package, kept {len(plugin_files) - dropped_count}")
    if without_package:
        log_info(f"{without_package} kept plugin(s) already list no package present in the index; left untouched")


def main(argv: list[str] | None = None) -> None:
    usage = """
Usage: python3 filterCatalogByAllowlist.py [--debug] \\
    [-d|--overlays-dir PATH] \\
    [-c|--catalog-dir PATH]

Example:
    python3 scripts/filterCatalogByAllowlist.py --overlays-dir . --catalog-dir catalog-index
"""
    parser = argparse.ArgumentParser(
        description='Remove from a generated catalog index every package the export allowlist does not '
                    'cover, drop the plugins left without a package, and rewrite the all.yaml lists.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=usage,
    )
    parser.error = lambda msg: (print(f"\n{Colors.RED}[ERROR] {msg}{Colors.NORM}\n{usage}", file=sys.stderr), sys.exit(2))
    parser.add_argument(
        '-d', '--overlays-dir',
        default='.',
        metavar='PATH',
        help='Overlays checkout containing workspaces/ (default: .)',
    )
    parser.add_argument(
        '-c', '--catalog-dir',
        default='catalog-index',
        metavar='PATH',
        help='Catalog index produced by update-index.sh (default: catalog-index)',
    )
    parser.add_argument('--debug', action='store_true', help='Enable debug output')
    args = parser.parse_args(argv)

    set_debug(args.debug)
    filter_catalog(Path(args.overlays_dir), Path(args.catalog_dir))


if __name__ == "__main__":
    main()
