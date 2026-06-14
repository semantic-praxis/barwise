/**
 * Assembles a multi-file ORM project from already-read file contents.
 *
 * This module is pure: the tool layer reads the `.orm-project.yaml`
 * manifest, the domain files, and the mapping files from disk and passes
 * their contents in. Core deserializes and attaches them, collecting
 * parse problems -- no filesystem access here.
 */

import type { ContextMapping, ContextMappingConfig } from "../model/ContextMapping.js";
import type { OrmProject } from "../model/OrmProject.js";
import { MappingSerializer } from "./MappingSerializer.js";
import { OrmYamlSerializer } from "./OrmYamlSerializer.js";
import { ProjectSerializer } from "./ProjectSerializer.js";

/**
 * The result of assembling a project manifest and its referenced files.
 */
export interface LoadedProject {
  /**
   * The project, with an OrmModel attached to every domain that resolved
   * and a ContextMapping added for every mapping that resolved.
   */
  readonly project: OrmProject;
  /**
   * Human-readable descriptions of referenced files that could not be
   * read or parsed. The project is still returned with whatever resolved
   * successfully; callers decide whether to treat these as fatal.
   */
  readonly problems: readonly string[];
}

/**
 * Error thrown when the project manifest itself cannot be parsed.
 *
 * Failures resolving individual referenced files are not fatal and are
 * reported via {@link LoadedProject.problems} instead. The tool layer
 * throws this for manifest read failures too.
 */
export class ProjectLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectLoadError";
  }
}

/** A referenced file's content, or the error the tool hit reading it. */
export type ProjectFile =
  | { readonly content: string; }
  | { readonly readError: string; };

/**
 * Already-read contents of a project's referenced files, keyed by the
 * path as it appears in the manifest (relative to the manifest dir).
 */
export interface ProjectFiles {
  readonly domains: ReadonlyMap<string, ProjectFile>;
  readonly mappings: ReadonlyMap<string, ProjectFile>;
}

/**
 * The domain and mapping paths a manifest references, relative to the
 * manifest's directory. The tool reads these and passes the contents to
 * {@link assembleProject}.
 *
 * @throws {ProjectLoadError} if the manifest cannot be parsed.
 */
export function projectFilePaths(
  manifestYaml: string,
): { domainPaths: readonly string[]; mappingPaths: readonly string[]; } {
  const project = parseManifestOrThrow(manifestYaml);
  return {
    domainPaths: project.domains.map((d) => d.path),
    mappingPaths: new ProjectSerializer().getMappingPaths(manifestYaml),
  };
}

/**
 * Build an OrmProject from a manifest and the already-read contents of
 * its domain and mapping files. Files that could not be read or parsed
 * are reported via {@link LoadedProject.problems}; the project is still
 * returned with whatever resolved.
 *
 * Product model files are not loaded: a `ProductDependency` carries only
 * a path/context reference, and `projectRules` validates products by
 * dependency name.
 *
 * @throws {ProjectLoadError} if the manifest itself cannot be parsed.
 */
export function assembleProject(
  manifestYaml: string,
  files: ProjectFiles,
): LoadedProject {
  const project = parseManifestOrThrow(manifestYaml);
  const problems: string[] = [];
  const modelSerializer = new OrmYamlSerializer();
  const mappingSerializer = new MappingSerializer();

  for (const domain of project.domains) {
    const label = `Domain "${domain.context}" (${domain.path})`;
    const file = files.domains.get(domain.path);
    if (!file) {
      problems.push(`${label}: file content not provided`);
    } else if ("readError" in file) {
      problems.push(`${label}: ${file.readError}`);
    } else {
      try {
        domain.setModel(modelSerializer.deserialize(file.content));
      } catch (err) {
        problems.push(`${label}: ${(err as Error).message}`);
      }
    }
  }

  for (const mappingPath of new ProjectSerializer().getMappingPaths(manifestYaml)) {
    const label = `Mapping (${mappingPath})`;
    const file = files.mappings.get(mappingPath);
    if (!file) {
      problems.push(`${label}: file content not provided`);
    } else if ("readError" in file) {
      problems.push(`${label}: ${file.readError}`);
    } else {
      try {
        const mapping = mappingSerializer.deserialize(file.content, mappingPath);
        project.addMapping(toMappingConfig(mapping));
      } catch (err) {
        problems.push(`${label}: ${(err as Error).message}`);
      }
    }
  }

  return { project, problems };
}

function parseManifestOrThrow(manifestYaml: string): OrmProject {
  try {
    return new ProjectSerializer().deserialize(manifestYaml);
  } catch (err) {
    throw new ProjectLoadError(
      `Failed to parse project manifest: ${(err as Error).message}`,
    );
  }
}

/**
 * Rebuild a ContextMappingConfig from a deserialized ContextMapping so
 * it can be added to the project.
 */
function toMappingConfig(mapping: ContextMapping): ContextMappingConfig {
  return {
    path: mapping.path,
    sourceContext: mapping.sourceContext,
    targetContext: mapping.targetContext,
    pattern: mapping.pattern,
    entityMappings: mapping.entityMappings.map((em) => ({
      sourceObjectType: em.sourceObjectType,
      targetObjectType: em.targetObjectType,
      description: em.description,
    })),
    semanticConflicts: mapping.semanticConflicts.map((sc) => ({
      term: sc.term,
      sourceMeaning: sc.sourceMeaning,
      targetMeaning: sc.targetMeaning,
      resolution: sc.resolution,
    })),
  };
}
