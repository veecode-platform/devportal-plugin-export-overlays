#!/usr/bin/env python3
#
# Checks the Package entities the marketplace catalog offers:
# - each entity validates against the portal's Package schema
#   (scripts/schemas/packages.json) and Backstage's metadata.name rule;
# - each spec.dynamicArtifact resolves anonymously with skopeo.
#
# Usage: checkCatalogPackages.py PATH... [--json FILE]
# PATH is a metadata file or a directory of them, such as a generated
# catalog-entities/extensions/packages. Exit codes: 0 clean, 1 findings, 2 usage.

import argparse
import json
import re
import shutil
import subprocess
import sys
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import Path

import yaml
from jsonschema import Draft7Validator

SCHEMA_FILE = Path(__file__).resolve().parent / "schemas" / "packages.json"

# Backstage isValidObjectName (catalog-model KubernetesValidatorFunctions.ts).
NAME_PATTERN = re.compile(r"([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9]")
NAME_MAX_LENGTH = 63

OCI_PREFIX = "oci://"
_REGISTRY_NAME = (
    r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]+)?"
    r"/[a-z0-9]+(?:[._/-][a-z0-9]+)*"
)
_TAG = r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}"
_DIGEST = r"sha256:[a-f0-9]{64}"
IMAGE_REFERENCE = re.compile(rf"{_REGISTRY_NAME}(?::{_TAG}(?:@{_DIGEST})?|@{_DIGEST})")

MISSING_MARKERS = ("manifest unknown", "name unknown", "not found")
UNAUTHORIZED_MARKERS = ("unauthorized", "denied", "forbidden", "authentication required")


class UsageError(Exception):
    pass


@dataclass
class Finding:
    path: str
    workspace: str | None
    entity: str | None
    check: str
    reason: str
    message: str
    reference: str | None = None


@dataclass
class Resolution:
    ok: bool
    reason: str
    message: str = ""


Resolver = Callable[[str], Resolution]


def workspace_of(path: Path) -> str | None:
    parts = path.parts
    for i in range(len(parts) - 2):
        if parts[i] == "workspaces" and parts[i + 2] == "metadata":
            return parts[i + 1]
    return None


def collect_files(paths: list[str]) -> list[Path]:
    files: list[Path] = []
    for raw in paths:
        path = Path(raw)
        if path.is_dir():
            files.extend(sorted([*path.glob("*.yaml"), *path.glob("*.yml")]))
        elif path.is_file():
            files.append(path)
        else:
            raise UsageError(f"{raw}: no such file or directory")
    if not files:
        raise UsageError("no YAML files found in the given paths")
    return files


def name_problem(name: str) -> str | None:
    if not 1 <= len(name) <= NAME_MAX_LENGTH:
        return f"metadata.name has {len(name)} characters (allowed: 1 to {NAME_MAX_LENGTH})"
    if not NAME_PATTERN.fullmatch(name):
        return "metadata.name must start and end with an alphanumeric character and use only [A-Za-z0-9-_.]"
    return None


def parse_reference(artifact: str) -> str | None:
    """Returns the registry reference inside an `oci://REF[!SELECTOR]` artifact, or None if malformed."""
    reference = artifact[len(OCI_PREFIX):].split("!", 1)[0]
    return reference if IMAGE_REFERENCE.fullmatch(reference) else None


def _failure_summary(text: str) -> str:
    lines = [line for line in text.strip().splitlines() if line.strip()]
    line = lines[-1][:400] if lines else ""
    logged = re.search(r'msg="(.*)"$', line)
    return logged.group(1).replace('\\"', '"') if logged else line


def classify_failure(stderr: str) -> str:
    text = stderr.lower()
    if any(marker in text for marker in MISSING_MARKERS):
        return "manifest-unknown"
    # quay.io answers "unauthorized" for a repository that does not exist, so this is a failure too.
    if any(marker in text for marker in UNAUTHORIZED_MARKERS):
        return "unauthorized"
    return "error"


def skopeo_resolver(timeout: int = 60, retries: int = 2, backoff: float = 2.0) -> Resolver:
    def resolve(reference: str) -> Resolution:
        result = Resolution(False, "error", "")
        for attempt in range(retries + 1):
            if attempt:
                time.sleep(backoff * attempt)
            try:
                proc = subprocess.run(
                    ["skopeo", "--command-timeout", f"{timeout}s", "inspect", "--raw", "--no-creds",
                     f"docker://{reference}"],
                    capture_output=True, text=True, timeout=timeout + 30, check=False,
                )
            except subprocess.TimeoutExpired:
                result = Resolution(False, "error", f"skopeo did not answer within {timeout}s")
                continue
            if proc.returncode == 0:
                return Resolution(True, "resolved")
            result = Resolution(False, classify_failure(proc.stderr), _failure_summary(proc.stderr))
            if result.reason != "error":
                break
        return result

    return resolve


def load_entities(path: Path) -> tuple[list[dict], list[Finding]]:
    workspace = workspace_of(path)
    try:
        documents = list(yaml.safe_load_all(path.read_text(encoding="utf-8")))
    except (yaml.YAMLError, UnicodeDecodeError, OSError) as error:
        return [], [Finding(str(path), workspace, None, "parse", "unreadable", str(error).splitlines()[0])]
    entities, findings = [], []
    for document in documents:
        if document is None:
            continue
        if isinstance(document, dict):
            entities.append(document)
        else:
            findings.append(Finding(str(path), workspace, None, "parse", "not-a-mapping",
                                    "YAML document is not a mapping"))
    return entities, findings


def check_files(files: list[Path], resolver: Resolver, jobs: int = 8) -> dict:
    started = time.monotonic()
    validator = Draft7Validator(json.loads(SCHEMA_FILE.read_text(encoding="utf-8")))
    findings: list[Finding] = []
    skipped: list[dict] = []
    to_resolve: list[tuple[Path, str | None, str | None, str]] = []
    packages = 0

    for path in files:
        workspace = workspace_of(path)
        entities, load_findings = load_entities(path)
        findings.extend(load_findings)
        for entity in entities:
            kind = entity.get("kind")
            if kind == "Location":
                continue
            metadata = entity.get("metadata")
            name = metadata.get("name") if isinstance(metadata, dict) else None
            name = name if isinstance(name, str) else None

            def add(check: str, reason: str, message: str, reference: str | None = None) -> None:
                findings.append(Finding(str(path), workspace, name, check, reason, message, reference))

            if kind != "Package":
                add("kind", "not-a-package", f"kind is {kind!r}, expected 'Package'")
                continue
            packages += 1
            for error in sorted(validator.iter_errors(entity), key=lambda e: list(map(str, e.absolute_path))):
                where = "/" + "/".join(map(str, error.absolute_path))
                add("schema", "schema-violation", f"{where}: {error.message}")
            if name is not None and (problem := name_problem(name)):
                add("name", "invalid-name", problem)

            spec = entity.get("spec")
            artifact = spec.get("dynamicArtifact") if isinstance(spec, dict) else None
            if not artifact:
                skipped.append({"path": str(path), "entity": name, "reason": "no-dynamic-artifact"})
            elif not isinstance(artifact, str):
                add("reference", "unsupported", "spec.dynamicArtifact is not a string")
            elif artifact.startswith(OCI_PREFIX):
                reference = parse_reference(artifact)
                if reference is None:
                    add("reference", "malformed", f"{artifact} is not a valid oci:// reference with a tag or digest",
                        artifact)
                else:
                    to_resolve.append((path, workspace, name, reference))
            elif artifact.startswith(("./", "/")):
                skipped.append({"path": str(path), "entity": name, "reason": "local-path", "reference": artifact})
            else:
                add("reference", "unsupported", f"{artifact} is neither an oci:// reference nor a local path",
                    artifact)

    unique = sorted({reference for *_, reference in to_resolve})
    with ThreadPoolExecutor(max_workers=max(1, jobs)) as pool:
        resolutions = dict(zip(unique, pool.map(resolver, unique)))
    unresolved = 0
    for path, workspace, name, reference in to_resolve:
        resolution = resolutions[reference]
        if not resolution.ok:
            unresolved += 1
            findings.append(Finding(str(path), workspace, name, "reference", resolution.reason,
                                    resolution.message, reference))

    findings.sort(key=lambda f: (f.path, f.check, f.message))
    return {
        "elapsed_seconds": round(time.monotonic() - started, 1),
        "files": len(files),
        "packages": packages,
        "references": {
            "resolved": len(to_resolve) - unresolved,
            "unresolved": unresolved,
            "skipped": len(skipped),
        },
        "findings": [asdict(f) for f in findings],
        "skipped": skipped,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate Package entities and resolve their spec.dynamicArtifact references."
    )
    parser.add_argument("paths", nargs="+", metavar="PATH", help="metadata files or directories of Package YAML files")
    parser.add_argument("--json", metavar="FILE", help="write the findings to FILE as JSON")
    parser.add_argument("--jobs", type=int, default=8, help="parallel skopeo calls (default: 8)")
    args = parser.parse_args(argv)

    try:
        files = collect_files(args.paths)
    except UsageError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    if shutil.which("skopeo") is None:
        print("error: skopeo is not installed", file=sys.stderr)
        return 2

    report = check_files(files, skopeo_resolver(), args.jobs)
    for finding in report["findings"]:
        subject = f" ({finding['entity']})" if finding["entity"] else ""
        print(f"[FAIL] {finding['path']}{subject}: {finding['check']}/{finding['reason']}: {finding['message']}")
    refs = report["references"]
    print(
        f"Checked {report['packages']} Package entities in {report['files']} files: "
        f"{len(report['findings'])} findings, {refs['resolved']} references resolved, "
        f"{refs['unresolved']} unresolved, {refs['skipped']} skipped, {report['elapsed_seconds']}s"
    )
    if args.json:
        Path(args.json).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return 1 if report["findings"] else 0


if __name__ == "__main__":
    sys.exit(main())
