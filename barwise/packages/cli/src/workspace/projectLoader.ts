/**
 * CLI project loader: the filesystem walk for a multi-file ORM project.
 *
 * Core assembles a project from already-read contents; this reads the
 * `.orm-project.yaml` manifest and each domain and mapping file it
 * references (resolved relative to the manifest directory), then hands
 * the contents to the pure assembler.
 */

import {
  assembleProject,
  type LoadedProject,
  type ProjectFile,
  projectFilePaths,
  ProjectLoadError,
} from "@barwise/core";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Load a `.orm-project.yaml` manifest and every file it references.
 *
 * @throws {ProjectLoadError} if the manifest cannot be read or parsed.
 */
export function loadProject(manifestPath: string): LoadedProject {
  let manifestYaml: string;
  try {
    manifestYaml = readFileSync(manifestPath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new ProjectLoadError(`Project manifest not found: ${manifestPath}`);
    }
    throw new ProjectLoadError(
      `Cannot read project manifest ${manifestPath}: ${(err as Error).message}`,
    );
  }

  const baseDir = dirname(manifestPath);
  const { domainPaths, mappingPaths } = projectFilePaths(manifestYaml);

  return assembleProject(manifestYaml, {
    domains: readReferencedFiles(baseDir, domainPaths),
    mappings: readReferencedFiles(baseDir, mappingPaths),
  });
}

function readReferencedFiles(
  baseDir: string,
  paths: readonly string[],
): Map<string, ProjectFile> {
  const files = new Map<string, ProjectFile>();
  for (const path of paths) {
    try {
      files.set(path, { content: readFileSync(resolve(baseDir, path), "utf-8") });
    } catch (err) {
      files.set(path, { readError: (err as Error).message });
    }
  }
  return files;
}
