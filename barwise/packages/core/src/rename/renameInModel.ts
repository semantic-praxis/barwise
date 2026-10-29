/**
 * Renaming an element (iri-identity WS5). Pure: the input model is never
 * changed, and the result is a new model read back from the edited
 * document.
 *
 * Working on the document, not the model, is what lets a rename carry
 * every field without listing them (a field nobody listed is a field
 * nobody keeps, barwise-937), and it is the only way to rename an object
 * type, which `createObjectType` returns as a frozen record with no name
 * setter. In 3.x every reference between elements is an id, so a rename
 * changes names and keeps every id; WS6 fills `ids` when ids become names.
 */

import { stringify } from "yaml";
import { toSnake } from "../mapping/columnNames.js";
import type { FactType } from "../model/FactType.js";
import { localName } from "../model/name.js";
import type { ObjectType } from "../model/ObjectType.js";
import type { OrmModel } from "../model/OrmModel.js";
import { OrmYamlSerializer, writeDocument } from "../serialization/OrmYamlSerializer.js";
import { CURRENT_ORM_VERSION } from "../serialization/schemaVersion.js";
import type { OrmYamlDocument } from "../serialization/yaml/document.js";

/**
 * What to rename. Explicit by kind, because an object type and a fact type
 * can share a name (an objectified fact type usually does), and a role by
 * name or by position, because 3.x role names are unique nowhere.
 */
export type RenameTarget =
  | { readonly kind: "objectType" | "factType"; readonly name: string; }
  | { readonly kind: "role"; readonly factType: string; readonly role: string | number; };

export interface RenameResult {
  /** The renamed model; the input is unchanged. */
  readonly model: OrmModel;
  /** Old id to new id. Empty on 3.x, where a rename keeps every id. */
  readonly ids: ReadonlyMap<string, string>;
  /** Every rewrite, in plain words, for a surface to print. */
  readonly changes: readonly string[];
}

/** A rename that cannot be done; the message says why. */
export class RenameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenameError";
  }
}

/**
 * Rename one element of a model.
 *
 * @throws {RenameError} when the target does not exist or is ambiguous,
 * the new name is empty, unchanged, or taken, the target is a shadow (it
 * is renamed through its owner, with `renameInProject`), or the model's
 * current-version form would not load.
 */
export function renameInModel(model: OrmModel, target: RenameTarget, to: string): RenameResult {
  const plan = planRename(model, target, to, { shadow: "refuse" });
  const doc = writeDocument(model);
  const changes: string[] = [];
  applyToDocument(doc, model, plan, changes, {
    definitionTermFree: (old) => !holdsName(model, old, plan.elementId),
  });
  return { model: readBack(doc), ids: new Map(), changes };
}

// ---------------------------------------------------------------------------
// The pieces renameInProject reuses
// ---------------------------------------------------------------------------

/** A checked rename of one element of one model. */
export interface RenamePlan {
  readonly kind: RenameTarget["kind"];
  /** The id of the renamed object type, fact type, or role. */
  readonly elementId: string;
  /** For a role, its fact type's id. */
  readonly factTypeId?: string;
  readonly from: string;
  readonly to: string;
  /** How the element is named in `changes`. */
  readonly label: string;
}

/**
 * Resolve the target and check the new name, throwing `RenameError` with
 * the reason when the rename cannot be done in this model. `shadow:
 * "allow"` is the project cascade renaming a shadow through its owner;
 * every other refusal still applies.
 */
export function planRename(
  model: OrmModel,
  target: RenameTarget,
  to: string,
  options: { readonly shadow: "refuse" | "allow"; },
): RenamePlan {
  const name = to.trim();
  if (name.length === 0) throw new RenameError("The new name is empty.");

  if (target.kind === "role") return planRoleRename(model, target, name);

  const element = target.kind === "objectType"
    ? model.getObjectTypeByName(target.name)
    : model.getFactTypeByName(target.name);
  const what = target.kind === "objectType" ? "object type" : "fact type";
  if (!element) {
    throw new RenameError(`No ${what} named "${target.name}" in model "${model.name}".`);
  }
  if (name === element.name) throw new RenameError(`The ${what} is already named "${name}".`);
  if (target.kind === "objectType" && options.shadow === "refuse") {
    const context = (element as ObjectType).sourceContext;
    if (context !== undefined) {
      throw new RenameError(
        `"${element.name}" is a shadow of an object type owned by "${context}"; `
          + `rename it there, through the project, so every copy follows.`,
      );
    }
  }
  refuseTakenName(model, target.kind, element.id, name);
  return {
    kind: target.kind,
    elementId: element.id,
    from: element.name,
    to: name,
    label: `${what} "${element.name}"`,
  };
}

/**
 * Apply a checked rename to the model's document: the element's own name,
 * its definition when `definitionTermFree` is given (the project decides
 * definitions itself, across domains), and the reference modes that name a
 * renamed value type. Returns
 * the ids of the entities whose reference mode changed, so the project
 * cascade can follow them into their shadows.
 */
export function applyToDocument(
  doc: OrmYamlDocument,
  model: OrmModel,
  plan: RenamePlan,
  changes: string[],
  options: { readonly definitionTermFree?: (oldName: string) => boolean; readonly where?: string; },
): readonly string[] {
  const where = options.where === undefined ? "" : ` in ${options.where}`;
  if (plan.kind === "role") {
    const ft = doc.model.fact_types?.find((f) => f.id === plan.factTypeId);
    const role = ft?.roles.find((r) => r.id === plan.elementId);
    if (role) role.role_name = plan.to;
    changes.push(`Renamed ${plan.label} to "${plan.to}"${where}.`);
    return [];
  }

  const list = plan.kind === "objectType" ? doc.model.object_types : doc.model.fact_types;
  const element = list?.find((e) => e.id === plan.elementId);
  if (element) element.name = plan.to;
  changes.push(`Renamed ${plan.label} to "${plan.to}"${where}.`);

  if (options.definitionTermFree) {
    renameDefinition(doc, plan.from, plan.to, changes, options.definitionTermFree, where);
  }
  return plan.kind === "objectType" ? renameReferenceModes(doc, model, plan, changes, where) : [];
}

/**
 * Rewrite the definition whose term is the old name, when the term is the
 * renamed element's alone and the new term is not already defined. A
 * second definition with one term would vanish from diff, which keys
 * definitions by term in a map.
 */
export function renameDefinition(
  doc: OrmYamlDocument,
  from: string,
  to: string,
  changes: string[],
  termFree: (oldName: string) => boolean,
  where = "",
): void {
  const definitions = doc.model.definitions ?? [];
  const definition = definitions.find((d) => d.term === from);
  if (!definition) return;
  if (!termFree(from)) {
    changes.push(
      `Left the definition of "${from}"${where}: another element is also named "${from}".`,
    );
  } else if (definitions.some((d) => d.term === to)) {
    changes.push(
      `Left the definition of "${from}"${where}: a definition of "${to}" already exists.`,
    );
  } else {
    definition.term = to;
    changes.push(`Renamed the definition of "${from}" to "${to}"${where}.`);
  }
}

/** Read an edited document back into a model, as a lenient load would. */
export function readBack(doc: OrmYamlDocument): OrmModel {
  try {
    return new OrmYamlSerializer().deserialize(stringify(doc), { lenient: true });
  } catch (err) {
    // A 2.0 file can hold what 3.0 refuses (two constraints sharing an
    // id), and `barwise migrate` refuses such a file in the same words.
    throw new RenameError(
      `Not renamed: its ${CURRENT_ORM_VERSION} form would not load: ${(err as Error).message}`,
    );
  }
}

/** Whether an object type or fact type other than `exceptId` holds `name`. */
export function holdsName(model: OrmModel, name: string, exceptId: string): boolean {
  return [...model.objectTypes, ...model.factTypes].some((e) =>
    e.id !== exceptId && e.name === name
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function planRoleRename(
  model: OrmModel,
  target: Extract<RenameTarget, { kind: "role"; }>,
  name: string,
): RenamePlan {
  const ft = model.getFactTypeByName(target.factType);
  if (!ft) {
    throw new RenameError(`No fact type named "${target.factType}" in model "${model.name}".`);
  }
  const index = roleIndex(ft, target.role);
  const role = ft.roles[index]!;
  if (name === role.name) throw new RenameError(`The role is already named "${name}".`);
  const taken = ft.roles.find((r, i) => i !== index && localName(r.name) === localName(name));
  if (taken) {
    throw new RenameError(
      `Fact type "${ft.name}" already has a role named "${taken.name}", which would share the `
        + `local name "${localName(name)}" (decision 5).`,
    );
  }
  if (localName(name) === "population" && model.populations.some((p) => p.factTypeId === ft.id)) {
    throw new RenameError(
      `A role of a populated fact type cannot be named "population": it would share its `
        + `population's id (decision 7).`,
    );
  }
  return {
    kind: "role",
    elementId: role.id,
    factTypeId: ft.id,
    from: role.name,
    to: name,
    label: `role "${role.name}" (position ${index}) of fact type "${ft.name}"`,
  };
}

function roleIndex(ft: FactType, role: string | number): number {
  if (typeof role === "number") {
    if (!Number.isInteger(role) || role < 0 || role >= ft.roles.length) {
      throw new RenameError(`Fact type "${ft.name}" has no role at position ${role}.`);
    }
    return role;
  }
  const positions = ft.roles.flatMap((r, i) => (r.name === role ? [i] : []));
  if (positions.length === 0) {
    throw new RenameError(`Fact type "${ft.name}" has no role named "${role}".`);
  }
  if (positions.length > 1) {
    throw new RenameError(
      `Fact type "${ft.name}" has ${positions.length} roles named "${role}" (positions `
        + `${positions.join(", ")}); name the one to rename by its position.`,
    );
  }
  return positions[0]!;
}

/**
 * Refuse a name another object type or fact type holds, or whose local
 * name another holds across kinds: a rename should not create what 4.0's
 * migration would have to suffix (WS2's `local-name-collision`).
 */
function refuseTakenName(
  model: OrmModel,
  kind: "objectType" | "factType",
  selfId: string,
  name: string,
): void {
  const local = localName(name);
  for (const ot of model.objectTypes) {
    if (ot.id !== selfId && localName(ot.name) === local) {
      throw takenError(model, "object type", ot.name, name, kind === "objectType");
    }
  }
  for (const ft of model.factTypes) {
    if (ft.id !== selfId && localName(ft.name) === local) {
      throw takenError(model, "fact type", ft.name, name, kind === "factType");
    }
  }
}

/**
 * The same name in the same kind is the duplicate `addObjectType` and
 * `addFactType` refuse; anything else that shares a local name is the
 * cross-kind collision 4.0 would suffix.
 */
function takenError(
  model: OrmModel,
  what: string,
  holder: string,
  name: string,
  sameKind: boolean,
): RenameError {
  return sameKind && holder === name
    ? new RenameError(
      `There is already ${
        what === "object type" ? "an" : "a"
      } ${what} named "${name}" in model "${model.name}".`,
    )
    : new RenameError(
      `"${name}" would share the local name "${localName(name)}" with ${what} "${holder}" `
        + `in model "${model.name}".`,
    );
}

/**
 * The reference modes that name a renamed value type. The relational
 * mapper types an entity's key from the value type it plays in a binary
 * fact type whose `toSnake` name equals the entity's `reference_mode`
 * (`referenceModePkType`); a rename that left the string would silently
 * untype the key column. An entity with that string that does not play the
 * value type is left alone, because the mapper never tied the two.
 */
function renameReferenceModes(
  doc: OrmYamlDocument,
  model: OrmModel,
  plan: RenamePlan,
  changes: string[],
  where: string,
): readonly string[] {
  const valueType = model.getObjectType(plan.elementId);
  if (valueType?.kind !== "value") return [];
  const from = toSnake(plan.from);
  const to = toSnake(plan.to);
  const players = new Set<string>();
  for (const ft of model.factTypes) {
    if (ft.arity !== 2) continue;
    const [a, b] = ft.roles;
    if (a!.playerId === valueType.id) players.add(b!.playerId);
    if (b!.playerId === valueType.id) players.add(a!.playerId);
  }
  const changed: string[] = [];
  for (const ot of doc.model.object_types ?? []) {
    if (ot.kind !== "entity" || ot.reference_mode !== from || !players.has(ot.id)) continue;
    ot.reference_mode = to;
    changed.push(ot.id);
    changes.push(`Changed the reference mode of "${ot.name}" from "${from}" to "${to}"${where}.`);
  }
  return changed;
}
