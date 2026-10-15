import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
GENERATOR = REPO_ROOT / "scripts" / "generateDynamicPluginsDefaultYaml.sh"

FACE_ENABLED = (
    "backstage-community-plugin-rbac",
    "backstage-community-plugin-tech-radar",
    "backstage-community-plugin-tech-radar-backend",
    "backstage-plugin-notifications",
    "backstage-plugin-notifications-backend",
    "backstage-plugin-signals",
    "backstage-plugin-signals-backend",
    "backstage-plugin-techdocs",
    "backstage-plugin-techdocs-backend",
    "backstage-plugin-techdocs-module-addons-contrib",
    "devportal-marketplace-backend",
    "devportal-marketplace-frontend-dynamic",
    "devportal-pending-changes-dynamic",
    "red-hat-developer-hub-backstage-plugin-catalog-backend-module-extensions",
    "red-hat-developer-hub-backstage-plugin-global-header",
    "veecode-platform-backstage-plugin-about",
    "veecode-platform-backstage-plugin-about-backend",
    "veecode-platform-plugin-veecode-homepage",
)

HOME_PAGE = "red-hat-developer-hub-backstage-plugin-dynamic-home-page"

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


def test_generated_default_list_enables_exactly_the_face_packages(generated_default_list):
    enabled = sorted(
        repository
        for repository, entry in generated_default_list.items()
        if entry.get("disabled") is False
    )
    assert enabled == sorted(FACE_ENABLED)


def test_generated_default_list_keeps_the_dynamic_home_page_disabled(generated_default_list):
    assert generated_default_list[HOME_PAGE].get("disabled") is True


def test_generated_default_list_has_the_image_shipped_plugins_disabled(generated_default_list):
    missing = [r for r in IMAGE_SHIPPED_DISABLED if r not in generated_default_list]
    not_disabled = [
        r for r in IMAGE_SHIPPED_DISABLED
        if r in generated_default_list and generated_default_list[r].get("disabled") is not True
    ]
    assert (missing, not_disabled) == ([], [])
