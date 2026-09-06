/**
 * Splits a monolithic `.orm.yaml` model into a multi-domain project:
 * one `.orm.yaml` per bounded context, suggested `.map.yaml` context
 * mappings for any object type that is shared across a context seam,
 * and a `.orm-project.yaml` manifest tying them together.
 *
 * The split operates on the serialized document rather than the
 * in-memory `OrmModel`: partitioning the parsed document is lossless
 * (it carries every field, including ones this code does not enumerate)
 * and each output document is re-checked by deserializing it.
 */

import { parse, stringify } from "yaml";
import { ContextMapping } from "../model/ContextMapping.js";
import { OrmProject } from "../model/OrmProject.js";
import { MappingSerializer } from "../serialization/MappingSerializer.js";
import { OrmYamlSerializer } from "../serialization/OrmYamlSerializer.js";
import { ProjectSerializer } from "../serialization/ProjectSerializer.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Instructions for a split: a project name and, per bounded context, the
 * names of the object types that context owns.
 *
 * The assignment may be partial. Any object type not listed is given a
 * home by inference from the fact types it participates in; if inference
 * fails it is placed in the first context and reported as a warning.
 */
export interface SplitConfig {
  /** Name written into the generated `.orm-project.yaml`. */
  readonly projectName: string;
  /** Context name to the object type names that context owns. */
  readonly domains: Readonly<Record<string, readonly string[]>>;
}

/** A generated domain model file. */
export interface SplitDomainFile {
  /** The bounded context name. */
  readonly context: string;
  /** Path relative to the project root, e.g. `domains/catalog.orm.yaml`. */
  readonly fileName: string;
  /** The `.orm.yaml` content. */
  readonly yaml: string;
}

/** A generated context mapping file. */
export interface SplitMappingFile {
  /** Path relative to the project root, e.g. `mappings/a-b.map.yaml`. */
  readonly fileName: string;
  /** The `.map.yaml` content. */
  readonly yaml: string;
}

/** The complete output of a split. */
export interface SplitResult {
  /** The `.orm-project.yaml` manifest content. */
  readonly manifestYaml: string;
  /** One entry per context, in config order. */
  readonly domains: readonly SplitDomainFile[];
  /** Suggested context mappings for shared object types. */
  readonly mappings: readonly SplitMappingFile[];
  /**
   * Non-fatal observations: inferred homes, dropped cross-domain
   * constraints, generated mappings, and other things the user should
   * review and resolve by making the config explicit.
   */
  readonly warnings: readonly string[];
}

/** Error thrown when a model cannot be split. */
export class ModelSplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelSplitError";
  }
}

// ---------------------------------------------------------------------------
// Document shapes (a loose mirror of orm-model.schema.json)
// ---------------------------------------------------------------------------

interface RawObjectType {
  id: string;
  name: string;
  kind: string;
  source_context?: string;
  [key: string]: unknown;
}

interface RawRole {
  id: string;
  player: string;
  [key: string]: unknown;
}

interface RawConstraint {
  type: string;
  [key: string]: unknown;
}

interface RawFactType {
  id: string;
  name: string;
  roles: RawRole[];
  readings: string[];
  constraints?: RawConstraint[];
  [key: string]: unknown;
}

interface RawSubtypeFact {
  id: string;
  subtype: string;
  supertype: string;
  [key: string]: unknown;
}

interface RawObjectified {
  id: string;
  fact_type: string;
  object_type: string;
  [key: string]: unknown;
}

interface RawPopulation {
  id: string;
  fact_type: string;
  [key: string]: unknown;
}

interface RawModelDoc {
  // Required by orm-model.schema.json at the root, and the source is
  // schema-validated before it is read as raw YAML, so the domain docs
  // carry the source's version through. A `?? "1.0"` fallback lived
  // here for a year and could never fire (barwise-5t9.14).
  orm_version: string;
  model: {
    name: string;
    object_types?: RawObjectType[];
    fact_types?: RawFactType[];
    subtype_facts?: RawSubtypeFact[];
    objectified_fact_types?: RawObjectified[];
    populations?: RawPopulation[];
    definitions?: unknown[];
    diagrams?: unknown[];
  };
}

// ---------------------------------------------------------------------------
// Split
// ---------------------------------------------------------------------------

/**
 * Split a serialized monolithic ORM model into a multi-domain project.
 *
 * @throws {ModelSplitError} if the config is empty, the input is not a
 * valid ORM model, or the model references object types that do not
 * exist.
 */
export function splitModel(modelYaml: string, config: SplitConfig): SplitResult {
  const contexts = Object.keys(config.domains);
  if (config.projectName.trim().length === 0) {
    throw new ModelSplitError("Split config must have a non-empty projectName.");
  }
  if (contexts.length < 2) {
    throw new ModelSplitError(
      "Split config must define at least two domains.",
    );
  }

  // Fail fast if the input is not a valid model.
  try {
    new OrmYamlSerializer().deserialize(modelYaml);
  } catch (err) {
    throw new ModelSplitError(
      `Source is not a valid ORM model: ${(err as Error).message}`,
    );
  }

  const doc = parse(modelYaml) as RawModelDoc;
  const model = doc.model;
  const objectTypes = model.object_types ?? [];
  const factTypes = model.fact_types ?? [];
  const subtypeFacts = model.subtype_facts ?? [];
  const objectified = model.objectified_fact_types ?? [];
  const populations = model.populations ?? [];

  const warnings: string[] = [];
  const otById = new Map(objectTypes.map((o) => [o.id, o]));
  const otByName = new Map(objectTypes.map((o) => [o.name, o]));

  // -- Home every object type to a context -------------------------------
  // Explicit config assignments first, then inference from the fact
  // types and subtype facts an object type participates in.
  const home = new Map<string, string>();
  applyConfigHomes(home, config, contexts, otByName, warnings);
  const neighbors = buildNeighbors(factTypes, subtypeFacts);
  const inferred: string[] = [];
  inferHomes(home, objectTypes, neighbors, inferred);

  // -- Home every fact type ----------------------------------------------
  const ftHome = new Map<string, string>();
  for (const ft of factTypes) {
    ftHome.set(ft.id, pickFactTypeHome(ft, home, contexts));
  }

  // Objectification is intrinsic to a fact type: keep the objectifying
  // object type in the same context as the fact type it objectifies.
  for (const obj of objectified) {
    const ctx = ftHome.get(obj.fact_type);
    const ot = otById.get(obj.object_type);
    if (!ctx || !ot) continue;
    const current = home.get(obj.object_type);
    if (current === ctx) continue;
    if (current !== undefined) {
      warnings.push(
        `Object type "${ot.name}" objectifies a fact type homed in `
          + `"${ctx}"; homed there (config assigned it to "${current}").`,
      );
    }
    home.set(obj.object_type, ctx);
  }

  // A second inference pass: objectified object types are now homed, so
  // their neighbours can be resolved too.
  inferHomes(home, objectTypes, neighbors, inferred);
  if (inferred.length > 0) {
    warnings.push(
      `Inferred a domain for ${inferred.length} object type(s) not listed `
        + `in the config: ${inferred.join(", ")}.`,
    );
  }

  // Anything still unhomed falls back to the first context.
  const fallback = contexts[0] ?? "";
  for (const ot of objectTypes) {
    if (home.has(ot.id)) continue;
    home.set(ot.id, fallback);
    warnings.push(
      `Could not infer a domain for object type "${ot.name}"; placed it in `
        + `"${fallback}". Assign it explicitly in the config.`,
    );
  }

  // -- Global role index, for detecting cross-domain constraints ---------
  const roleToFt = new Map<string, string>();
  for (const ft of factTypes) {
    for (const role of ft.roles) {
      roleToFt.set(role.id, ft.id);
    }
  }

  // -- Build each domain document ----------------------------------------
  const domains: SplitDomainFile[] = [];
  // Owner context -> shadow context -> shared object type names.
  const seams = new Map<string, Map<string, Set<string>>>();

  contexts.forEach((ctx, index) => {
    const homedOts = objectTypes.filter((o) => home.get(o.id) === ctx);
    const homedFts = factTypes.filter((f) => ftHome.get(f.id) === ctx);
    const homedSubtypes = subtypeFacts.filter(
      (s) => home.get(s.subtype) === ctx,
    );
    const homedObjd = objectified.filter(
      (o) => ftHome.get(o.fact_type) === ctx,
    );
    const homedPops = populations.filter(
      (p) => ftHome.get(p.fact_type) === ctx,
    );

    // Every object type id this context's elements reference.
    const referenced = new Set<string>();
    for (const ft of homedFts) {
      for (const role of ft.roles) referenced.add(role.player);
    }
    for (const sf of homedSubtypes) {
      referenced.add(sf.subtype);
      referenced.add(sf.supertype);
    }
    for (const obj of homedObjd) referenced.add(obj.object_type);

    // Foreign references become shadows; record the seam.
    const shadows: RawObjectType[] = [];
    for (const id of referenced) {
      const owner = home.get(id);
      if (!owner || owner === ctx) continue;
      const ot = otById.get(id);
      if (!ot) continue;
      shadows.push({ ...ot, source_context: owner });
      let byShadow = seams.get(owner);
      if (!byShadow) {
        byShadow = new Map();
        seams.set(owner, byShadow);
      }
      let names = byShadow.get(ctx);
      if (!names) {
        names = new Set();
        byShadow.set(ctx, names);
      }
      names.add(ot.name);
    }

    // Drop constraints that reach into another context's fact types.
    const cleanedFts = homedFts.map((ft) => {
      if (!ft.constraints || ft.constraints.length === 0) return ft;
      const kept: RawConstraint[] = [];
      for (const constraint of ft.constraints) {
        if (constraintIsLocal(constraint, ctx, roleToFt, ftHome)) {
          kept.push(constraint);
        } else {
          warnings.push(
            `Dropped a "${constraint.type}" constraint on fact type `
              + `"${ft.name}" in domain "${ctx}": it references roles owned `
              + `by another domain.`,
          );
        }
      }
      return { ...ft, constraints: kept };
    });

    if (homedOts.length === 0 && cleanedFts.length === 0) {
      warnings.push(`Domain "${ctx}" has no object types or fact types.`);
    }

    const domainModel: RawModelDoc["model"] & { domain_context: string; } = {
      name: ctx,
      domain_context: ctx,
    };
    const allOts = [...homedOts, ...shadows];
    if (allOts.length > 0) domainModel.object_types = allOts;
    if (cleanedFts.length > 0) domainModel.fact_types = cleanedFts;
    if (homedSubtypes.length > 0) domainModel.subtype_facts = homedSubtypes;
    if (homedObjd.length > 0) domainModel.objectified_fact_types = homedObjd;
    if (homedPops.length > 0) domainModel.populations = homedPops;
    // Glossary definitions are not element-scoped; keep them with the
    // first domain so they are not lost.
    if (index === 0 && model.definitions && model.definitions.length > 0) {
      domainModel.definitions = model.definitions;
    }

    const domainDoc: RawModelDoc = {
      orm_version: doc.orm_version,
      model: domainModel,
    };
    const yaml = stringify(domainDoc, { lineWidth: 0 });

    // Re-parse as a sanity check; a failure is a bug worth surfacing.
    try {
      new OrmYamlSerializer().deserialize(yaml);
    } catch (err) {
      warnings.push(
        `Generated domain "${ctx}" did not round-trip cleanly: `
          + `${(err as Error).message}`,
      );
    }

    domains.push({
      context: ctx,
      fileName: `domains/${ctx}.orm.yaml`,
      yaml,
    });
  });

  if (model.diagrams && model.diagrams.length > 0) {
    warnings.push(
      `Source model has ${model.diagrams.length} diagram layout(s); `
        + `these are not carried into the split.`,
    );
  }

  // -- Build mapping files ------------------------------------------------
  const mappingSerializer = new MappingSerializer();
  const mappings: SplitMappingFile[] = [];
  const project = new OrmProject({ name: config.projectName.trim() });
  for (const ctx of contexts) {
    project.addDomain({ path: `domains/${ctx}.orm.yaml`, context: ctx });
  }

  for (const [owner, byShadow] of seams) {
    for (const [shadowCtx, names] of byShadow) {
      const sorted = [...names].sort();
      const fileName = `mappings/${owner}-${shadowCtx}.map.yaml`;
      const mapping = new ContextMapping({
        path: fileName,
        sourceContext: owner,
        targetContext: shadowCtx,
        pattern: "shared_kernel",
        entityMappings: sorted.map((name) => ({
          sourceObjectType: name,
          targetObjectType: name,
          description: `"${name}" is owned by "${owner}" and referenced by "${shadowCtx}".`,
        })),
      });
      mappings.push({
        fileName,
        yaml: mappingSerializer.serialize(mapping),
      });
      project.addMapping({
        path: fileName,
        sourceContext: owner,
        targetContext: shadowCtx,
        pattern: "shared_kernel",
      });
      warnings.push(
        `Domains "${owner}" and "${shadowCtx}" share ${sorted.length} `
          + `object type(s) (${sorted.join(", ")}); wrote ${fileName}.`,
      );
    }
  }

  const manifestYaml = new ProjectSerializer().serialize(project);

  return { manifestYaml, domains, mappings, warnings };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Apply the explicit config assignments to the home map, reporting
 * unknown names and object types assigned to more than one domain.
 */
function applyConfigHomes(
  home: Map<string, string>,
  config: SplitConfig,
  contexts: readonly string[],
  otByName: ReadonlyMap<string, RawObjectType>,
  warnings: string[],
): void {
  for (const ctx of contexts) {
    for (const name of config.domains[ctx] ?? []) {
      const ot = otByName.get(name);
      if (!ot) {
        warnings.push(
          `Config assigns object type "${name}" to domain "${ctx}", but `
            + `the source model has no such object type.`,
        );
        continue;
      }
      const existing = home.get(ot.id);
      if (existing && existing !== ctx) {
        warnings.push(
          `Object type "${name}" is assigned to multiple domains `
            + `("${existing}" and "${ctx}"); keeping "${existing}".`,
        );
        continue;
      }
      home.set(ot.id, ctx);
    }
  }
}

/**
 * Build adjacency: object type id -> ids of the object types it shares a
 * fact type or subtype fact with.
 */
function buildNeighbors(
  factTypes: readonly RawFactType[],
  subtypeFacts: readonly RawSubtypeFact[],
): Map<string, string[]> {
  const neighbors = new Map<string, string[]>();
  const addEdge = (a: string, b: string): void => {
    if (a === b) return;
    const list = neighbors.get(a);
    if (list) list.push(b);
    else neighbors.set(a, [b]);
  };
  for (const ft of factTypes) {
    const players = ft.roles.map((r) => r.player);
    for (const a of players) {
      for (const b of players) addEdge(a, b);
    }
  }
  for (const sf of subtypeFacts) {
    addEdge(sf.subtype, sf.supertype);
    addEdge(sf.supertype, sf.subtype);
  }
  return neighbors;
}

/**
 * Give a home to every still-unhomed object type by majority vote among
 * its already-homed neighbours. Iterates until stable (a value type
 * carried to its entity carried to a context needs only a few hops).
 * Each newly inferred home is appended to `inferred`.
 */
function inferHomes(
  home: Map<string, string>,
  objectTypes: readonly RawObjectType[],
  neighbors: ReadonlyMap<string, readonly string[]>,
  inferred: string[],
): void {
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const ot of objectTypes) {
      if (home.has(ot.id)) continue;
      const votes = new Map<string, number>();
      for (const neighbor of neighbors.get(ot.id) ?? []) {
        const ctx = home.get(neighbor);
        if (ctx) votes.set(ctx, (votes.get(ctx) ?? 0) + 1);
      }
      const winner = pickWinner(votes);
      if (winner) {
        home.set(ot.id, winner);
        inferred.push(`${ot.name} -> ${winner}`);
        changed = true;
      }
    }
    if (!changed) break;
  }
}

/**
 * Pick the context for a fact type: the context owning the most of its
 * distinct role players, ties broken by the first role.
 */
function pickFactTypeHome(
  ft: RawFactType,
  home: ReadonlyMap<string, string>,
  contexts: readonly string[],
): string {
  const votes = new Map<string, number>();
  const seenPlayers = new Set<string>();
  for (const role of ft.roles) {
    if (seenPlayers.has(role.player)) continue;
    seenPlayers.add(role.player);
    const ctx = home.get(role.player);
    if (ctx) votes.set(ctx, (votes.get(ctx) ?? 0) + 1);
  }
  const winner = pickWinner(votes);
  if (winner) {
    // Honour a tie by preferring the first role's context.
    const max = Math.max(...votes.values());
    const firstCtx = home.get(ft.roles[0]?.player ?? "");
    if (firstCtx && votes.get(firstCtx) === max) return firstCtx;
    return winner;
  }
  return contexts[0] ?? "";
}

/** Return the key with the highest count, or undefined if empty. */
function pickWinner(votes: ReadonlyMap<string, number>): string | undefined {
  let best: string | undefined;
  let bestCount = 0;
  for (const [key, count] of votes) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

/** All role ids a constraint references, across every constraint shape. */
function constraintRoleIds(constraint: RawConstraint): string[] {
  const ids: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value === "string") ids.push(value);
    else if (Array.isArray(value)) {
      for (const v of value) if (typeof v === "string") ids.push(v);
    }
  };
  push(constraint.roles);
  push(constraint.role);
  push(constraint.subset_roles);
  push(constraint.superset_roles);
  push(constraint.roles_1);
  push(constraint.roles_2);
  push(constraint.role_1);
  push(constraint.role_2);
  return ids;
}

/**
 * True if every role a constraint references belongs to a fact type
 * homed in the given context.
 */
function constraintIsLocal(
  constraint: RawConstraint,
  ctx: string,
  roleToFt: ReadonlyMap<string, string>,
  ftHome: ReadonlyMap<string, string>,
): boolean {
  for (const roleId of constraintRoleIds(constraint)) {
    const ftId = roleToFt.get(roleId);
    if (!ftId || ftHome.get(ftId) !== ctx) return false;
  }
  return true;
}
