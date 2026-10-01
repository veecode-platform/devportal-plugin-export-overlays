"""The product face ships 13 plugins itself, so the default list must not offer them.

A face plugin that is also in the generated dynamic-plugins.default.yaml fails the
installer with a duplicate plugin key, or is silently dropped, so none of the 13
repositories below may appear there. The face-owned Packages are also left out of
the generator's plugin_builds, which means nothing rewrites their tag and version:
the tag must be typed to match spec.version.
"""

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
GENERATOR = REPO_ROOT / "scripts" / "generateDynamicPluginsDefaultYaml.sh"

FACE_OWNED = (
    "backstage-plugin-techdocs",
    "backstage-plugin-techdocs-backend",
    "backstage-plugin-techdocs-module-addons-contrib",
    "backstage-plugin-notifications",
    "backstage-plugin-notifications-backend",
    "backstage-plugin-signals",
    "backstage-plugin-signals-backend",
    "backstage-community-plugin-rbac",
    "backstage-community-plugin-tech-radar",
    "backstage-community-plugin-tech-radar-backend",
    "red-hat-developer-hub-backstage-plugin-global-header",
    "red-hat-developer-hub-backstage-plugin-catalog-backend-module-extensions",
    "red-hat-developer-hub-backstage-plugin-dynamic-home-page",
)

IMAGE_SHIPPED_DISABLED = (
    "backstage-plugin-kubernetes",
    "backstage-plugin-kubernetes-backend",
    "backstage-plugin-catalog-backend-module-github",
    "backstage-plugin-catalog-backend-module-github-org",
    "backstage-plugin-catalog-backend-module-gitlab",
    "backstage-plugin-catalog-backend-module-gitlab-org",
    "backstage-plugin-catalog-backend-module-ldap",
    "backstage-plugin-catalog-backend-module-msgraph",
    "backstage-plugin-scaffolder-backend-module-github",
    "backstage-plugin-scaffolder-backend-module-gitlab",
)

REFERENCE = re.compile(
    r"^oci://quay\.io/veecode/(?P<repository>[^:!@]+)"
    r"(?::(?P<tag>[^!@]+))?(?:@[^!]+)?(?:!(?P<selector>.+))?$"
)
TAG_VERSION = re.compile(r"^bs_[0-9.]+__(?P<version>.+)$")


def repository_of(package: str) -> str:
    match = REFERENCE.match(package)
    assert match, f"not a quay.io/veecode reference: {package}"
    return match["repository"]


@pytest.fixture(scope="module")
def generated_default_list(tmp_path_factory):
    if shutil.which("yq") is None:
        message = "yq is not installed, the default list cannot be generated"
        if os.environ.get("CI"):
            pytest.fail(message)
        pytest.skip(message)
    out = tmp_path_factory.mktemp("default-list")
    plugin_builds = out / "plugin_builds"
    plugin_builds.mkdir()
    result = subprocess.run(
        [
            str(GENERATOR),
            "--overlays-dir", str(REPO_ROOT),
            "--packages-file", str(REPO_ROOT / "default.packages.yaml"),
            "--output-file", str(out / "dynamic-plugins.default.yaml"),
            "--plugin-builds-dir", str(plugin_builds),
        ],
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    document = yaml.safe_load((out / "dynamic-plugins.default.yaml").read_text(encoding="utf-8"))
    return {repository_of(entry["package"]): entry for entry in document["plugins"]}


def test_generated_default_list_has_no_face_owned_repository(generated_default_list):
    present = sorted(set(FACE_OWNED) & set(generated_default_list))
    assert present == []


def test_generated_default_list_has_the_image_shipped_plugins_disabled(generated_default_list):
    missing = [r for r in IMAGE_SHIPPED_DISABLED if r not in generated_default_list]
    not_disabled = [
        r for r in IMAGE_SHIPPED_DISABLED
        if r in generated_default_list and generated_default_list[r].get("disabled") is not True
    ]
    assert (missing, not_disabled) == ([], [])


def test_face_owned_packages_reference_the_tag_of_their_version():
    found = {}
    for path in sorted((REPO_ROOT / "workspaces").glob("*/metadata/*.yaml")):
        document = yaml.safe_load(path.read_text(encoding="utf-8"))
        spec = document["spec"]
        reference = REFERENCE.match(spec.get("dynamicArtifact", ""))
        if reference and reference["repository"] in FACE_OWNED:
            tag = TAG_VERSION.match(reference["tag"] or "")
            found[reference["repository"]] = (
                spec["version"], tag["version"] if tag else reference["tag"], reference["selector"],
            )
    assert sorted(found) == sorted(FACE_OWNED)
    wrong = {
        repository: values
        for repository, values in found.items()
        if values[0] != values[1] or values[2] not in (None, repository)
    }
    assert wrong == {}
