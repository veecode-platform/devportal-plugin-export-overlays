"""Tests for filterCatalogByAllowlist.py."""

from pathlib import Path

import pytest
import yaml

from filterCatalogByAllowlist import main
from generateCatalogIndex import regenerate_all_yaml_files


def add_workspace(
    overlays: Path,
    name: str,
    plugins_list: str | None,
    packages: dict[str, str],
    dynamic_artifacts: dict[str, str] | None = None,
) -> None:
    """Create a workspace; ``plugins_list=None`` writes plugins-list.yaml.disabled.

    ``packages`` maps a metadata file name to the Package entity name inside it.
    """
    ws = overlays / "workspaces" / name
    (ws / "metadata").mkdir(parents=True)
    listing = "plugins-list.yaml" if plugins_list is not None else "plugins-list.yaml.disabled"
    (ws / listing).write_text(plugins_list or "plugins/unused:\n")
    for file_name, entity_name in packages.items():
        dynamic_artifact = (dynamic_artifacts or {}).get(file_name)
        dynamic_artifact_line = f"  dynamicArtifact: {dynamic_artifact}\n" if dynamic_artifact else ""
        (ws / "metadata" / file_name).write_text(
            "apiVersion: extensions.backstage.io/v1alpha1\n"
            "kind: Package\n"
            "metadata:\n"
            f"  name: {entity_name}\n"
            "spec:\n"
            f"  packageName: '@acme/{entity_name}'\n"
            f"{dynamic_artifact_line}"
        )


def add_catalog(
    catalog: Path,
    packages: dict[str, str],
    plugins: dict[str, list],
    collections: dict[str, list[str]] | None = None,
) -> None:
    """Create a generated index. ``plugins`` maps a Plugin name to its ``spec.packages``."""
    extensions = catalog / "catalog-entities" / "extensions"
    for directory in ("packages", "plugins", "collections"):
        (extensions / directory).mkdir(parents=True)
    for file_name, entity_name in packages.items():
        (extensions / "packages" / file_name).write_text(
            f"kind: Package\nmetadata:\n  name: {entity_name}\n"
        )
    for plugin_name, refs in plugins.items():
        (extensions / "plugins" / f"{plugin_name}.yaml").write_text(
            yaml.safe_dump({"kind": "Plugin", "metadata": {"name": plugin_name}, "spec": {"packages": refs}})
        )
    for collection_name, plugin_names in (collections or {}).items():
        (extensions / "collections" / f"{collection_name}.yaml").write_text(
            yaml.safe_dump({"kind": "PluginCollection", "metadata": {"name": collection_name}, "spec": {"plugins": plugin_names}})
        )
    regenerate_all_yaml_files(catalog)


def run_filter(overlays: Path, catalog: Path) -> None:
    main(["--overlays-dir", str(overlays), "--catalog-dir", str(catalog)])


def targets(catalog: Path, directory: str) -> list[str]:
    all_yaml = catalog / "catalog-entities" / "extensions" / directory / "all.yaml"
    return [t.removeprefix("./") for t in yaml.safe_load(all_yaml.read_text())["spec"]["targets"]]


def files(catalog: Path, directory: str) -> list[str]:
    folder = catalog / "catalog-entities" / "extensions" / directory
    return sorted(f.name for f in folder.glob("*.yaml") if f.name != "all.yaml")


@pytest.fixture
def index(tmp_path):
    """Overlays with one enabled workspace (one plugin line commented) and one disabled workspace."""
    overlays, catalog = tmp_path / "overlays", tmp_path / "catalog-index"
    add_workspace(
        overlays, "alpha", "plugins/one:\n#plugins/two:\n",
        {"acme-one.yaml": "acme-one", "acme-two.yaml": "acme-two"},
    )
    add_workspace(overlays, "beta", None, {"acme-three.yaml": "acme-three"})
    add_catalog(
        catalog,
        packages={"acme-one.yaml": "acme-one", "acme-two.yaml": "acme-two", "acme-three.yaml": "acme-three"},
        plugins={
            "one": ["acme-one"],
            "two": ["acme-two"],
            "three": [{"name": "acme-three"}],
            "mixed": ["acme-one", "acme-three"],
            "bundled": ["not-in-the-index"],
        },
        collections={"featured": ["three", "one"]},
    )
    return overlays, catalog


def test_package_of_a_disabled_workspace_is_removed(index):
    overlays, catalog = index
    run_filter(overlays, catalog)
    assert "acme-three.yaml" not in files(catalog, "packages")


def test_local_path_package_of_a_disabled_workspace_is_kept_but_oci_is_removed(tmp_path, capsys):
    overlays, catalog = tmp_path / "overlays", tmp_path / "catalog-index"
    add_workspace(
        overlays,
        "disabled",
        None,
        {"acme-local.yaml": "acme-local", "acme-oci.yaml": "acme-oci"},
        dynamic_artifacts={
            "acme-local.yaml": "./dynamic-plugins/dist/acme-local",
            "acme-oci.yaml": "oci://ghcr.io/acme/acme-oci:1.0.0",
        },
    )
    add_workspace(overlays, "active", "plugins/enabled:\n", {"acme-enabled.yaml": "acme-enabled"})
    add_catalog(
        catalog,
        packages={
            "acme-local.yaml": "acme-local",
            "acme-oci.yaml": "acme-oci",
            "acme-enabled.yaml": "acme-enabled",
        },
        plugins={
            "local": ["acme-local"],
            "oci": ["acme-oci"],
            "enabled": ["acme-enabled"],
        },
    )

    run_filter(overlays, catalog)

    assert files(catalog, "packages") == ["acme-enabled.yaml", "acme-local.yaml"]
    assert files(catalog, "plugins") == ["enabled.yaml", "local.yaml"]
    output = capsys.readouterr().out
    assert "Removed 1 package(s) (workspace disabled: 1), kept 2 (image-shipped local path: 1)" in output


def test_package_with_a_commented_plugin_line_is_removed(index):
    overlays, catalog = index
    run_filter(overlays, catalog)
    assert files(catalog, "packages") == ["acme-one.yaml"]


def test_all_yaml_lists_exactly_the_files_that_remain(index):
    overlays, catalog = index
    run_filter(overlays, catalog)
    assert targets(catalog, "packages") == files(catalog, "packages") == ["acme-one.yaml"]
    assert targets(catalog, "plugins") == files(catalog, "plugins")


def test_plugin_whose_packages_all_left_is_dropped(index):
    overlays, catalog = index
    run_filter(overlays, catalog)
    remaining = files(catalog, "plugins")
    assert "two.yaml" not in remaining
    assert "three.yaml" not in remaining


def test_plugin_that_keeps_a_package_or_had_none_in_the_index_stays(index):
    overlays, catalog = index
    run_filter(overlays, catalog)
    assert files(catalog, "plugins") == ["bundled.yaml", "mixed.yaml", "one.yaml"]


def test_plugin_without_packages_is_removed_but_unresolved_reference_is_kept(tmp_path):
    overlays, catalog = tmp_path / "overlays", tmp_path / "catalog-index"
    add_workspace(overlays, "disabled", None, {"acme-removed.yaml": "acme-removed"})
    add_workspace(overlays, "active", "plugins/one:\n", {"acme-one.yaml": "acme-one"})
    add_catalog(
        catalog,
        packages={"acme-removed.yaml": "acme-removed", "acme-one.yaml": "acme-one"},
        plugins={
            "empty": [],
            "bundled": ["not-in-the-index"],
            "mixed": ["acme-removed", "not-in-the-index"],
            "active": ["acme-one"],
        },
    )

    run_filter(overlays, catalog)

    assert files(catalog, "plugins") == ["active.yaml", "bundled.yaml", "mixed.yaml"]


def test_package_shared_by_a_disabled_and_an_enabled_workspace_fails_and_names_both_sources(tmp_path, capsys):
    overlays, catalog = tmp_path / "overlays", tmp_path / "catalog-index"
    add_workspace(overlays, "old", None, {"acme-one.yaml": "acme-one"})
    add_workspace(overlays, "new", "plugins/one:\n", {"acme-one.yaml": "acme-one"})
    add_catalog(catalog, packages={"acme-one.yaml": "acme-one"}, plugins={"one": ["acme-one"]})
    with pytest.raises(SystemExit) as exit_info:
        run_filter(overlays, catalog)
    assert exit_info.value.code == 1
    output = capsys.readouterr().out
    assert "workspaces/old/metadata/acme-one.yaml" in output
    assert "workspaces/new/metadata/acme-one.yaml" in output
    assert files(catalog, "packages") == ["acme-one.yaml"]
    assert files(catalog, "plugins") == ["one.yaml"]


def test_collection_listing_a_dropped_plugin_is_reported_and_left_alone(index, capsys):
    overlays, catalog = index
    collection = catalog / "catalog-entities" / "extensions" / "collections" / "featured.yaml"
    before = collection.read_text()
    run_filter(overlays, catalog)
    assert collection.read_text() == before
    output = capsys.readouterr().out
    assert "featured.yaml" in output and "three" in output


def test_prints_the_removed_package_and_plugin_counts(index, capsys):
    overlays, catalog = index
    run_filter(overlays, catalog)
    output = capsys.readouterr().out
    assert "Removed 2 package(s)" in output
    assert "Removed 2 plugin(s)" in output


def test_second_run_removes_nothing(index, capsys):
    overlays, catalog = index
    run_filter(overlays, catalog)
    capsys.readouterr()
    run_filter(overlays, catalog)
    output = capsys.readouterr().out
    assert "Removed 0 package(s)" in output
    assert "Removed 0 plugin(s)" in output


def test_refuses_to_empty_the_index(tmp_path):
    overlays, catalog = tmp_path / "overlays", tmp_path / "catalog-index"
    add_workspace(overlays, "beta", None, {"acme-three.yaml": "acme-three"})
    add_catalog(catalog, packages={"acme-three.yaml": "acme-three"}, plugins={"three": ["acme-three"]})
    with pytest.raises(SystemExit) as exit_info:
        run_filter(overlays, catalog)
    assert exit_info.value.code == 1
    assert files(catalog, "packages") == ["acme-three.yaml"]
    assert files(catalog, "plugins") == ["three.yaml"]


def test_missing_catalog_directory_is_an_error(tmp_path):
    overlays = tmp_path / "overlays"
    add_workspace(overlays, "alpha", "plugins/one:\n", {"acme-one.yaml": "acme-one"})
    with pytest.raises(SystemExit) as exit_info:
        run_filter(overlays, tmp_path / "missing")
    assert exit_info.value.code == 1
