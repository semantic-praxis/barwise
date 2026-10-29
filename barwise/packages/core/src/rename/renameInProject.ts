/**
 * Renaming an element of a multi-domain project (iri-identity WS5): the
 * rename `renameInModel` does, in the named domain and every domain it
 * reaches. Pure: the input project and its models are never changed.
 *
 * What links domains in 3.x is names, not ids: a shadow is an object type
 * whose `source_context` names its owner's domain and whose name is the
 * owner's (split also copies the owner's id, but a hand-written shadow
 * need not), and a mapping file names object types by plain name. So the
 * cascade follows names, and `files` says which files it changed.
 */

import type { ContextMappingConfig } from "../model/ContextMapping.js";
import type { OrmModel } from "../model/OrmModel.js";
import { OrmProject } from "../model/OrmProject.js";
import { writeDocument } from "../serialization/OrmYamlSerializer.js";
import { toMappingConfig } from "../serialization/projectAssembly.js";
import type { OrmYamlDocument } from "../serialization/yaml/document.js";
import {
  applyToDocument,
  planRename,
  readBack,
  renameDefinition,
  RenameError,
  type RenamePlan,
  type RenameTarget,
} from "./renameInModel.js";

export interface ProjectRenameResult {
  /** The renamed project; the input is unchanged. */
  readonly project: OrmProject;
  /** Old id to new id. Empty on 3.x, where a rename keeps every id. */
  readonly ids: ReadonlyMap<string, string>;
  /** Every rewrite, in plain words, for a surface to print. */
  readonly changes: readonly string[];
  /** Each domain and mapping path whose content changed, to write. */
  readonly files: readonly string[];
}

/**
 * Rename one element of the domain `context`, and follow it into the
 * shadows, reference modes, definitions and mapping files that name it.
 *
 * @throws {RenameError} when a domain is not loaded, the context is not a
 * domain, or the rename is refused in any domain it reaches.
 */
export function renameInProject(
  project: OrmProject,
  context: string,
  target: RenameTarget,
  to: string,
): ProjectRenameResult {
  const models = loadedModels(project);
  const owner = models.get(context);
  if (!owner) throw new RenameError(`The project has no domain "${context}".`);

  const plan = planRename(owner, target, to, { shadow: "refuse" });
  const changes: string[] = [];
  const docs = new Map<string, OrmYamlDocument>();
  const docOf = (ctx: string): OrmYamlDocument => {
    let doc = docs.get(ctx);
    if (!doc) {
      doc = writeDocument(models.get(ctx)!);
      docs.set(ctx, doc);
    }
    return doc;
  };

  // The renamed element and, for an object type, each shadow of it, with
  // the shadow's domain checked by the same refusals as the owner's.
  const renamed: { context: string; plan: RenamePlan; }[] = [{ context, plan }];
  if (plan.kind === "objectType") {
    for (const [ctx, model] of models) {
      if (ctx === context) continue;
      const shadow = model.objectTypes.find((ot) =>
        ot.sourceContext === context && ot.name === plan.from
      );
      if (!shadow) continue;
      const shadowPlan = planInDomain(model, ctx, { kind: "objectType", name: plan.from }, plan.to);
      renamed.push({ context: ctx, plan: shadowPlan });
    }
  }

  // A definition's term is the renamed element's alone when nothing else
  // anywhere in the project holds the name: split writes every definition
  // into the first domain, whatever owns the term.
  const renamedIds = new Set(renamed.map((r) => `${r.context}\u0000${r.plan.elementId}`));
  const termFree = (name: string): boolean =>
    ![...models].some(([ctx, model]) =>
      [...model.objectTypes, ...model.factTypes].some((e) =>
        e.name === name && !renamedIds.has(`${ctx}\u0000${e.id}`)
      )
    );

  const entitiesWithNewMode = new Map<string, readonly string[]>();
  for (const { context: ctx, plan: p } of renamed) {
    const changed = applyToDocument(docOf(ctx), models.get(ctx)!, p, changes, {
      where: `domain "${ctx}"`,
    });
    entitiesWithNewMode.set(ctx, changed);
  }

  if (plan.kind !== "role") renameDefinitionsAnywhere(models, docOf, plan, changes, termFree);
  if (plan.kind === "objectType") {
    followReferenceModes(models, docOf, entitiesWithNewMode, plan, changes);
  }

  const shadowContexts = new Set(renamed.slice(1).map((r) => r.context));
  const mappings = project.mappings.map((m) => {
    const config = toMappingConfig(m);
    if (plan.kind !== "objectType") return { config, changed: false };
    return renameInMapping(config, context, shadowContexts, plan.from, plan.to, changes);
  });

  const renamedModels = new Map<string, OrmModel>();
  for (const [ctx, doc] of docs) renamedModels.set(ctx, readBack(doc));

  const next = new OrmProject({
    name: project.name,
    iriBase: project.iriBase,
    settings: project.settings,
    products: project.products.map((p) => ({
      path: p.path,
      context: p.context,
      dependsOnDomains: [...p.dependsOnDomains],
      dependsOnMappings: [...p.dependsOnMappings],
    })),
  });
  for (const domain of project.domains) {
    next.addDomain({ path: domain.path, context: domain.context })
      .setModel(renamedModels.get(domain.context) ?? domain.model!);
  }
  for (const { config } of mappings) next.addMapping(config);

  if (project.products.length > 0) {
    changes.push(
      "Data products are not loaded as models, so any reference to the old name in a product file was not checked.",
    );
  }

  const files = [
    ...project.domains.filter((d) => renamedModels.has(d.context)).map((d) => d.path),
    ...mappings.filter((m) => m.changed).map((m) => m.config.path),
  ];
  return { project: next, ids: new Map(), changes, files };
}

/** Every domain's model, refusing a project with a domain not loaded. */
function loadedModels(project: OrmProject): Map<string, OrmModel> {
  const models = new Map<string, OrmModel>();
  for (const domain of project.domains) {
    if (!domain.model) {
      throw new RenameError(
        `Domain "${domain.context}" (${domain.path}) is not loaded, so a rename cannot follow `
          + `the element into it.`,
      );
    }
    models.set(domain.context, domain.model);
  }
  return models;
}

/** `planRename` for a shadow, with the domain named in any refusal. */
function planInDomain(model: OrmModel, ctx: string, target: RenameTarget, to: string): RenamePlan {
  try {
    return planRename(model, target, to, { shadow: "allow" });
  } catch (err) {
    if (err instanceof RenameError) throw new RenameError(`In domain "${ctx}": ${err.message}`);
    throw err;
  }
}

function renameDefinitionsAnywhere(
  models: ReadonlyMap<string, OrmModel>,
  docOf: (ctx: string) => OrmYamlDocument,
  plan: RenamePlan,
  changes: string[],
  termFree: (name: string) => boolean,
): void {
  for (const [ctx, model] of models) {
    if (!model.definitions.some((d) => d.term === plan.from)) continue;
    renameDefinition(docOf(ctx), plan.from, plan.to, changes, termFree, ` in domain "${ctx}"`);
  }
}

/**
 * An entity whose reference mode a value-type rename changed may have
 * shadows in other domains, which split gives the same reference mode and
 * which the mapper keys from it; a shadow left behind would give two
 * domains different key names for one entity.
 */
function followReferenceModes(
  models: ReadonlyMap<string, OrmModel>,
  docOf: (ctx: string) => OrmYamlDocument,
  entitiesWithNewMode: ReadonlyMap<string, readonly string[]>,
  plan: RenamePlan,
  changes: string[],
): void {
  for (const [ownerCtx, ids] of entitiesWithNewMode) {
    for (const id of ids) {
      const entity = docOf(ownerCtx).model.object_types?.find((ot) => ot.id === id);
      if (!entity || entity.source_context !== undefined) continue;
      for (const [ctx, model] of models) {
        if (ctx === ownerCtx) continue;
        const shadow = model.objectTypes.find((ot) =>
          ot.sourceContext === ownerCtx && ot.name === entity.name
        );
        if (!shadow || shadow.kind !== "entity" || shadow.referenceMode === entity.reference_mode) {
          continue;
        }
        const shadowDoc = docOf(ctx).model.object_types?.find((ot) => ot.id === shadow.id);
        if (!shadowDoc) continue;
        shadowDoc.reference_mode = entity.reference_mode;
        changes.push(
          `Changed the reference mode of "${entity.name}" to "${entity.reference_mode}" in domain "${ctx}", `
            + `following its owner after "${plan.from}" was renamed.`,
        );
      }
    }
  }
}

/**
 * Rewrite a mapping side whose context is the owner's, or a domain whose
 * shadow was renamed, and whose name is the old name. Split writes the
 * owner on the source side and the shadow on the target side.
 */
function renameInMapping(
  config: ContextMappingConfig,
  ownerContext: string,
  shadowContexts: ReadonlySet<string>,
  from: string,
  to: string,
  changes: string[],
): { config: ContextMappingConfig; changed: boolean; } {
  const reaches = (ctx: string) => ctx === ownerContext || shadowContexts.has(ctx);
  let changed = false;
  const entityMappings = (config.entityMappings ?? []).map((em) => {
    const source = reaches(config.sourceContext) && em.sourceObjectType === from;
    const target = reaches(config.targetContext) && em.targetObjectType === from;
    if (!source && !target) return em;
    changed = true;
    return {
      ...em,
      sourceObjectType: source ? to : em.sourceObjectType,
      targetObjectType: target ? to : em.targetObjectType,
    };
  });
  if (changed) changes.push(`Renamed "${from}" to "${to}" in mapping ${config.path}.`);
  return { config: { ...config, entityMappings }, changed };
}
