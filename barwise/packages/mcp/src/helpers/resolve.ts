/**
 * Source resolution: determine whether a source string is a file path
 * or inline YAML content, and deserialize accordingly.
 */

import { type OrmModel, OrmYamlSerializer } from "@barwise/core";
import { existsSync, readFileSync } from "node:fs";
import { loadProject } from "./projectLoader.js";

const serializer = new OrmYamlSerializer();

/**
 * Resolve a source string to an OrmModel. If the source looks like a
 * file path (no newlines, ends with .yaml/.yml, or file exists on disk),
 * read and deserialize it. Otherwise, treat it as inline YAML content.
 */
export function resolveSource(
  source: string,
  options?: { lenient?: boolean; },
): OrmModel {
  const trimmed = source.trim();

  if (isFilePath(trimmed)) {
    const yaml = readFileSync(trimmed, "utf-8");
    return serializer.deserialize(yaml, options);
  }

  return serializer.deserialize(trimmed, options);
}

/**
 * Read a file as a UTF-8 string. Throws on missing file.
 */
export function readSource(source: string): string {
  const trimmed = source.trim();

  if (isFilePath(trimmed)) {
    return readFileSync(trimmed, "utf-8");
  }

  return trimmed;
}

export function isFilePath(source: string): boolean {
  // Inline YAML will have newlines; file paths won't.
  if (source.includes("\n")) return false;

  // Looks like a YAML file path.
  if (source.endsWith(".yaml") || source.endsWith(".yml")) return true;

  // Check if it actually exists on disk.
  return existsSync(source);
}

/**
 * True if the source names a multi-domain project manifest
 * (`.orm-project.yaml`) on disk, rather than a single model or inline YAML.
 * A manifest references other files by path, so it is always a file path.
 */
export function isProjectSource(source: string): boolean {
  const trimmed = source.trim();
  return isFilePath(trimmed) && trimmed.endsWith(".orm-project.yaml");
}

/** One model to operate on, labelled with its domain context when from a project. */
export interface ResolvedDomain {
  /** The domain context name, or undefined for a single-model source. */
  readonly context?: string;
  readonly model: OrmModel;
}

export interface ResolvedDomains {
  readonly resolved: readonly ResolvedDomain[];
  /** Non-fatal assembly warnings (e.g. a domain file that failed to load). */
  readonly problems: readonly string[];
}

/**
 * Resolve a tool `source` (a single model, inline YAML, or a
 * `.orm-project.yaml` manifest) plus an optional `domain` selector into the
 * model(s) the tool should operate on. Mirrors the CLI's `resolveDomainModels`
 * so the MCP read tools handle a project the same way the CLI commands do.
 *
 * - a single model or inline YAML  -> one unlabelled entry;
 * - a project with a `domain`       -> just that domain (throws if unknown);
 * - a project with no `domain`      -> one entry per loaded domain, labelled.
 *
 * @throws if a named domain is unknown or could not be loaded.
 */
export function resolveModels(source: string, domain?: string): ResolvedDomains {
  if (!isProjectSource(source)) {
    return { resolved: [{ model: resolveSource(source) }], problems: [] };
  }

  const { project, problems } = loadProject(source.trim());

  if (domain !== undefined) {
    const dm = project.getDomain(domain);
    if (!dm) {
      const available = project.domains.map((d) => d.context).join(", ");
      throw new Error(
        `project has no domain "${domain}". Available: ${available || "(none)"}.`,
      );
    }
    if (!dm.model) {
      throw new Error(`domain "${domain}" could not be loaded; see warnings.`);
    }
    return { resolved: [{ context: domain, model: dm.model }], problems };
  }

  const resolved: ResolvedDomain[] = [];
  for (const dm of project.domains) {
    if (dm.model) resolved.push({ context: dm.context, model: dm.model });
  }
  return { resolved, problems };
}

export { serializer };
