/*
 * Copyright (c) Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 */

// The OCI path is deliberately kept separate from the npm resolver. The
// metadata's dynamicArtifact is the exact build RHDH installs, so compiled
// schemas are read from it as-is rather than compiling or patching source files.

import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { JsonObject } from "@backstage/types";
import { isPlainObject } from "./json.js";

const execFileAsync = promisify(execFile);

const OCI_PREFIX = "oci://";
const QUAY_VEECODE_PREFIX = "quay.io/veecode/";
const IMAGE_REFERENCE =
  /^quay\.io\/veecode\/[a-z0-9]+(?:[._/-][a-z0-9]+)*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const DIRECTORY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DIGEST = /^sha256:([a-f0-9]{64})$/;

/** The registry image and optional package directory selected by `!`. */
export type OciReference = {
  image: string;
  directory?: string;
};

/** One compiled schema in the shape accepted by loadConfigSchema({ serialized }). */
export type OciSchemaDocument = {
  path: string;
  value: JsonObject;
};

/** Injectable copy seam used by unit tests; production uses the skopeo command. */
export type OciImageCopier = (
  reference: OciReference,
  destination: string,
) => Promise<void>;

/** Injectable loader seam used by SchemaResolver tests. */
export type OciSchemaLoader = (
  reference: OciReference,
  destination: string,
) => Promise<OciSchemaDocument | undefined>;

/**
 * Parses the OCI references emitted by this repository's metadata.
 *
 * Only anonymous Quay images in the VeeCode namespace are accepted. The
 * directory selector is kept relative and component-safe because it later
 * becomes a path below an extracted, registry-controlled layer.
 */
export function parseOciReference(value: string): OciReference | undefined {
  if (!value.startsWith(OCI_PREFIX)) {
    return undefined;
  }

  const parts = value.slice(OCI_PREFIX.length).split("!");
  if (parts.length > 2) {
    return undefined;
  }
  const [image, directory] = parts;
  if (
    !image.startsWith(QUAY_VEECODE_PREFIX) ||
    !IMAGE_REFERENCE.test(image) ||
    (directory !== undefined && !isSafeDirectory(directory))
  ) {
    return undefined;
  }
  return { image, directory };
}

/** Copies one public OCI image into skopeo's local `dir:` transport layout. */
export const copyOciImage: OciImageCopier = async (reference, destination) => {
  await execFileAsync("skopeo", [
    "copy",
    `docker://${reference.image}`,
    `dir:${destination}`,
  ]);
};

/**
 * Copies and extracts an OCI image, then reads its compiled config schema.
 *
 * `copyImage` is injectable so tests can use a local layer fixture without a
 * network request. Layers are extracted in manifest order, matching the image
 * filesystem that the container runtime presents to the plugin.
 */
export async function loadOciSchema(
  reference: OciReference,
  destination: string,
  copyImage: OciImageCopier = copyOciImage,
): Promise<OciSchemaDocument | undefined> {
  await copyImage(reference, destination);

  const manifest = await readManifest(join(destination, "manifest.json"));
  const root = join(destination, "extracted");
  await mkdir(root);

  for (const digest of manifest.layers) {
    const match = DIGEST.exec(digest);
    if (!match) {
      throw new Error(`unsupported OCI layer digest ${digest}`);
    }
    const layer = join(destination, match[1]);
    await execFileAsync("tar", ["-xf", layer, "--no-same-owner", "-C", root]);
  }

  const artifactDirectory = await selectArtifactDirectory(root, reference);
  return readCompiledSchema(artifactDirectory);
}

/** Reads the first supported compiled schema from an already-extracted package. */
export async function readCompiledSchema(
  artifactDirectory: string,
): Promise<OciSchemaDocument | undefined> {
  // The hidden dist schema is the common generated form and includes merged
  // dependency constraints. The other two names cover the frontend Scalprum
  // bundle and the backend package layout.
  const candidates = [
    "dist/.config-schema.json",
    "dist/configSchema.json",
    "dist-scalprum/configSchema.json",
  ];

  for (const candidate of candidates) {
    const path = join(artifactDirectory, candidate);
    if (!(await isRegularFile(path))) {
      continue;
    }
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isPlainObject(parsed)) {
      throw new Error(`compiled OCI schema is not an object: ${candidate}`);
    }
    return { path: candidate, value: parsed };
  }
  return undefined;
}

type OciManifest = { layers: string[] };

async function readManifest(path: string): Promise<OciManifest> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isPlainObject(parsed) || !Array.isArray(parsed.layers)) {
    throw new Error("OCI manifest has no layers");
  }
  const layers: string[] = [];
  for (const layer of parsed.layers) {
    if (!isPlainObject(layer) || typeof layer.digest !== "string") {
      throw new Error("OCI manifest contains an invalid layer");
    }
    layers.push(layer.digest);
  }
  return { layers };
}

async function selectArtifactDirectory(
  root: string,
  reference: OciReference,
): Promise<string> {
  if (reference.directory !== undefined) {
    const selected = resolve(root, reference.directory);
    if (!isInside(root, selected) || !(await isDirectory(selected))) {
      throw new Error(
        `OCI artifact directory not found: ${reference.directory}`,
      );
    }
    return selected;
  }

  const imageName = basename(
    reference.image.slice(0, reference.image.lastIndexOf(":")),
  );
  const conventional = join(root, imageName);
  if (await isDirectory(conventional)) {
    return conventional;
  }
  if (await hasCompiledSchema(root)) {
    return root;
  }

  const directories = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const candidates: string[] = [];
  for (const directory of directories) {
    if (await hasCompiledSchema(join(root, directory))) {
      candidates.push(directory);
    }
  }
  if (candidates.length === 1) {
    return join(root, candidates[0]);
  }
  if (candidates.length === 0) {
    if (directories.length === 0) {
      return root;
    }
    if (directories.length === 1) {
      return join(root, directories[0]);
    }
    throw new Error(
      `multiple artifact directories in OCI image ${reference.image}: ${directories.join(", ")}`,
    );
  }
  throw new Error(
    `multiple compiled schema directories in OCI image ${reference.image}: ${candidates.join(", ")}`,
  );
}

async function hasCompiledSchema(directory: string): Promise<boolean> {
  return (await readCompiledSchemaPath(directory)) !== undefined;
}

async function readCompiledSchemaPath(
  directory: string,
): Promise<string | undefined> {
  for (const candidate of [
    "dist/.config-schema.json",
    "dist/configSchema.json",
    "dist-scalprum/configSchema.json",
  ]) {
    if (await isRegularFile(join(directory, candidate))) {
      return candidate;
    }
  }
  return undefined;
}

function isSafeDirectory(directory: string): boolean {
  return (
    directory !== "" &&
    directory
      .split("/")
      .every(
        (part) => part !== "." && part !== ".." && DIRECTORY_SEGMENT.test(part),
      )
  );
}

function isInside(root: string, candidate: string): boolean {
  const target = relative(root, candidate);
  return target !== "" && !target.startsWith("..") && !target.startsWith("/");
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch {
    return false;
  }
}
