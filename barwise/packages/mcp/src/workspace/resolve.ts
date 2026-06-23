/**
 * Source resolution: turn a tool `source` -- a string (file path or inline
 * YAML) or a structured file object (`{ path?, content? }`) -- into an
 * OrmModel, and resolve a project manifest into its domains.
 */

import { type OrmModel, OrmYamlSerializer } from "@barwise/core";
import { existsSync, readFileSync } from "node:fs";
import { loadProject } from "./projectLoader.js";

const serializer = new OrmYamlSerializer();

/**
 * A model reference accepted by the tools. Either:
 * - a string: a file path or inline YAML, disambiguated by `isFilePath`; or
 * - an object: `{ path }` (read from disk), `{ content }` (inline YAML), or
 *   `{ path, content }` (parse `content`; `path` is the file's location,
 *   used to place spill/lineage output and to detect a project manifest --
 *   e.g. an unsaved editor buffer).
 *
 * The object form is explicit: it is never run through the path/content
 * heuristic.
 */
export type SourceInput = string | { path?: string; content?: string; };

/** A `source` normalized to an explicit path and/or inline content. */
interface NormalizedSource {
  /** The originating file path, when known. */
  readonly path?: string;
  /** Inline YAML content, when provided directly. */
  readonly content?: string;
}

/**
 * Normalize a `SourceInput` to an explicit `{ path?, content? }`. A string is
 * disambiguated by `isFilePath`; an object is taken as given (no heuristic).
 * Throws if an object carries neither a path nor content.
 */
function normalizeSource(input: SourceInput): NormalizedSource {
  if (typeof input === "string") {
    const trimmed = input.trim();
    return isFilePath(trimmed) ? { path: trimmed } : { content: trimmed };
  }

  const path = input.path?.trim() || undefined;
  const hasContent = input.content !== undefined && input.content.trim() !== "";
  if (path === undefined && !hasContent) {
    throw new Error("source object must provide `path`, `content`, or both.");
  }
  return { path, content: hasContent ? input.content : undefined };
}

/**
 * Resolve a `source` to an OrmModel. When content is present (inline, or the
 * combined object form) it is deserialized directly; otherwise the file at
 * `path` is read. The object form skips the path/content heuristic.
 */
export function resolveSource(
  input: SourceInput,
  options?: { lenient?: boolean; },
): OrmModel {
  const { path, content } = normalizeSource(input);
  const yaml = content ?? readFileSync(path!, "utf-8");
  return serializer.deserialize(yaml, options);
}

/**
 * Read a `source` as a UTF-8 string -- inline content as-is, or the file at
 * `path`. Throws on a missing file.
 */
export function readSource(input: SourceInput): string {
  const { path, content } = normalizeSource(input);
  return content ?? readFileSync(path!, "utf-8");
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
 * The originating file path of a `source`, when one is known -- used to place
 * spill/lineage output next to the model file. Inline content with no path
 * yields `undefined`.
 */
export function sourcePath(input: SourceInput): string | undefined {
  return normalizeSource(input).path;
}

/**
 * True if the source names a multi-domain project manifest
 * (`.orm-project.yaml`). A manifest references other files by path, so it is
 * only ever a path -- inline manifest content cannot resolve a project.
 */
export function isProjectSource(input: SourceInput): boolean {
  const { path } = normalizeSource(input);
  return path !== undefined && path.endsWith(".orm-project.yaml");
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
 * Resolve a tool `source` (a single model, inline YAML, a file object, or a
 * `.orm-project.yaml` manifest) plus an optional `domain` selector into the
 * model(s) the tool should operate on. Mirrors the CLI's `resolveDomainModels`
 * so the MCP read tools handle a project the same way the CLI commands do.
 *
 * - a single model or inline YAML  -> one unlabelled entry;
 * - a project with a `domain`       -> just that domain (throws if unknown);
 * - a project with no `domain`      -> one entry per loaded domain, labelled.
 *
 * @throws if a named domain is unknown, a domain could not be loaded, or a
 *   project manifest is given as inline content (it needs a path to resolve
 *   its referenced files).
 */
export function resolveModels(input: SourceInput, domain?: string): ResolvedDomains {
  const { path, content } = normalizeSource(input);

  if (path !== undefined && path.endsWith(".orm-project.yaml")) {
    return resolveProject(path, domain);
  }

  // A manifest supplied as inline content has no base directory to resolve
  // its referenced domain files against; require a path for projects.
  if (content !== undefined && looksLikeManifest(content)) {
    throw new Error(
      "a project manifest (.orm-project.yaml) must be given as a path, not "
        + "inline content: its referenced domain files are resolved relative "
        + "to the manifest's location.",
    );
  }

  return { resolved: [{ model: resolveSource(input) }], problems: [] };
}

/** Load a project manifest from disk and select the requested domain(s). */
function resolveProject(manifestPath: string, domain?: string): ResolvedDomains {
  const { project, problems } = loadProject(manifestPath);

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

/**
 * Cheap check that inline content is a project manifest rather than a model:
 * a manifest's top-level key is `project:`, a model's is `orm_version:`.
 */
function looksLikeManifest(content: string): boolean {
  return /^project\s*:/m.test(content) && !/^orm_version\s*:/m.test(content);
}

export { serializer };
