"""Tests for checkCatalogPackages.py — Package schema, name rule and dynamicArtifact resolution."""

import json
import os
import stat
from pathlib import Path

import pytest
import yaml

import checkCatalogPackages as check

REFERENCE = "quay.io/veecode/plugin-a:bs_1.52.0__1.0.0"


def package(name="plugin-a", artifact=f"oci://{REFERENCE}", **spec):
    return {
        "apiVersion": "extensions.backstage.io/v1alpha1",
        "kind": "Package",
        "metadata": {"name": name},
        "spec": {"packageName": f"@scope/{name}", "dynamicArtifact": artifact, **spec},
    }


def write(directory: Path, filename: str, *documents) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / filename
    path.write_text(yaml.safe_dump_all(documents), encoding="utf-8")
    return path


def resolves_everything(reference):
    return check.Resolution(True, "resolved")


def run(path, resolver=resolves_everything):
    return check.check_files(check.collect_files([str(path)]), resolver, jobs=2)


def reasons(report):
    return sorted((f["check"], f["reason"]) for f in report["findings"])


@pytest.fixture
def fake_skopeo(tmp_path, monkeypatch):
    """Puts a skopeo stand-in first on PATH; it logs its arguments and answers by reference name."""
    log = tmp_path / "skopeo.log"
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    script = bin_dir / "skopeo"
    script.write_text(
        "#!/bin/sh\n"
        'echo "$@" >> "$SKOPEO_LOG"\n'
        'case "$*" in\n'
        '  *missing-tag*) echo \'level=fatal msg="reading manifest: manifest unknown"\' >&2; exit 1;;\n'
        '  *no-repo*) echo \'level=fatal msg="reading manifest: unauthorized: access denied"\' >&2; exit 1;;\n'
        '  *flaky*) [ -e "$SKOPEO_LOG.flaky" ] && { echo "{}"; exit 0; }; touch "$SKOPEO_LOG.flaky";'
        ' echo "connection reset by peer" >&2; exit 1;;\n'
        '  *down*) echo "connection reset by peer" >&2; exit 1;;\n'
        "esac\n"
        'echo "{}"\n'
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("SKOPEO_LOG", str(log))
    return log


class TestSchemaAndName:
    def test_valid_package_has_no_findings(self, tmp_path):
        report = run(write(tmp_path, "a.yaml", package()))
        assert report["findings"] == []
        assert report["packages"] == 1

    @pytest.mark.parametrize("name", ["a" * 64, "-leading", "trailing-", "has space", "under_score_"])
    def test_invalid_names_are_reported(self, tmp_path, name):
        report = run(write(tmp_path, "a.yaml", package(name=name)))
        assert ("name", "invalid-name") in reasons(report)

    @pytest.mark.parametrize("name", ["a", "a" * 63, "a--b", "a.b_c-d"])
    def test_names_backstage_accepts_pass(self, tmp_path, name):
        assert run(write(tmp_path, "a.yaml", package(name=name)))["findings"] == []

    def test_extra_property_under_spec_backstage_is_a_schema_violation(self, tmp_path):
        entity = package(backstage={"role": "backend-plugin-module", "author": "Someone"})
        report = run(write(tmp_path, "a.yaml", entity))
        (finding,) = report["findings"]
        assert finding["check"] == "schema"
        assert "/spec/backstage" in finding["message"] and "author" in finding["message"]

    def test_finding_names_the_entity_and_workspace(self, tmp_path):
        metadata = tmp_path / "workspaces" / "demo" / "metadata"
        report = run(write(metadata, "a.yaml", package(name="x" * 70)))
        (finding,) = report["findings"]
        assert (finding["entity"], finding["workspace"]) == ("x" * 70, "demo")


class TestReferences:
    def test_selector_is_stripped_before_resolving(self, tmp_path):
        seen = []

        def resolver(reference):
            seen.append(reference)
            return check.Resolution(True, "resolved")

        run(write(tmp_path, "a.yaml", package(artifact=f"oci://{REFERENCE}!scope-plugin-a")), resolver)
        assert seen == [REFERENCE]

    def test_unresolvable_reference_is_reported_once_per_package(self, tmp_path):
        write(tmp_path, "a.yaml", package())
        write(tmp_path, "b.yaml", package(name="plugin-b"))
        calls = []

        def resolver(reference):
            calls.append(reference)
            return check.Resolution(False, "manifest-unknown", "manifest unknown")

        report = run(tmp_path, resolver)
        assert calls == [REFERENCE]
        assert [f["entity"] for f in report["findings"]] == ["plugin-a", "plugin-b"]
        assert report["references"]["unresolved"] == 2

    def test_local_path_is_skipped_not_failed(self, tmp_path):
        report = run(write(tmp_path, "a.yaml", package(artifact="./dynamic-plugins/dist/plugin-a")))
        assert report["findings"] == []
        assert report["skipped"][0]["reason"] == "local-path"

    @pytest.mark.parametrize(
        "artifact, reason",
        [
            ("oci://quay.io/veecode/plugin-a", "malformed"),
            ("oci://Quay.io/veecode/plugin-a:1", "malformed"),
            ("@scope/plugin-a@1.0.0", "unsupported"),
        ],
    )
    def test_malformed_and_unsupported_artifacts_are_reported(self, tmp_path, artifact, reason):
        report = run(write(tmp_path, "a.yaml", package(artifact=artifact)))
        assert reasons(report) == [("reference", reason)]


class TestSkopeoResolver:
    def resolve(self, name, retries=1):
        return check.skopeo_resolver(timeout=5, retries=retries, backoff=0)(f"quay.io/veecode/{name}:1.0.0")

    def test_resolves_anonymously(self, fake_skopeo):
        assert self.resolve("plugin-a").ok
        assert "inspect --raw --no-creds docker://quay.io/veecode/plugin-a:1.0.0" in fake_skopeo.read_text()

    def test_missing_tag_fails(self, fake_skopeo):
        result = self.resolve("missing-tag")
        assert (result.ok, result.reason) == (False, "manifest-unknown")

    def test_missing_repository_fails_instead_of_being_taken_for_a_private_one(self, fake_skopeo):
        result = self.resolve("no-repo")
        assert (result.ok, result.reason) == (False, "unauthorized")

    def test_transient_error_is_retried(self, fake_skopeo):
        assert self.resolve("flaky").ok

    def test_persistent_transient_error_fails_after_retries(self, fake_skopeo):
        result = self.resolve("down", retries=2)
        assert (result.ok, result.reason) == (False, "error")
        assert len(fake_skopeo.read_text().splitlines()) == 3


class TestCommandLine:
    def test_exit_codes_and_json_report(self, tmp_path, fake_skopeo, capsys):
        write(tmp_path / "in", "ok.yaml", package(artifact="oci://quay.io/veecode/plugin-a:1.0.0"))
        report_file = tmp_path / "report.json"
        assert check.main([str(tmp_path / "in"), "--json", str(report_file)]) == 0
        assert json.loads(report_file.read_text())["findings"] == []

        write(tmp_path / "in", "bad.yaml", package(name="plugin-b", artifact="oci://quay.io/veecode/missing-tag:1.0.0"))
        assert check.main([str(tmp_path / "in"), "--json", str(report_file)]) == 1
        (finding,) = json.loads(report_file.read_text())["findings"]
        assert finding["reason"] == "manifest-unknown" and finding["entity"] == "plugin-b"
        assert "[FAIL]" in capsys.readouterr().out

    def test_location_entities_in_a_packages_directory_are_ignored(self, tmp_path):
        location = {"apiVersion": "backstage.io/v1alpha1", "kind": "Location", "spec": {"targets": ["./a.yaml"]}}
        write(tmp_path, "all.yaml", location)
        write(tmp_path, "a.yaml", package())
        assert run(tmp_path)["packages"] == 1

    def test_other_kinds_and_unparsable_files_are_findings(self, tmp_path):
        write(tmp_path, "plugin.yaml", {"kind": "Plugin", "metadata": {"name": "p"}})
        (tmp_path / "broken.yaml").write_text("key: [unclosed\n", encoding="utf-8")
        assert reasons(run(tmp_path)) == [("kind", "not-a-package"), ("parse", "unreadable")]

    def test_missing_path_and_empty_directory_are_usage_errors(self, tmp_path, capsys):
        assert check.main([str(tmp_path / "missing")]) == 2
        assert check.main([str(tmp_path)]) == 2
        assert "error:" in capsys.readouterr().err
