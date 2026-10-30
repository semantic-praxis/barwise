import { groupRepeats } from "../util/groupRepeats.js";
import {
  type Constraint,
  type ExternalConstraint,
  type InternalConstraint,
  isOverSubtypes,
  roleIdsOf,
  subtypeFactIdsOf,
  withoutSubtypeFacts,
} from "./Constraint.js";
import type { Definition } from "./Definition.js";
import { type DiagramLayout, withoutDiagramReferences } from "./DiagramLayout.js";
import { checkInternalConstraint, FactType, type FactTypeConfig } from "./FactType.js";
import { generateId } from "./id.js";
import { IdIndex, type IdKeyedKind, IdKeyedStore, type IdKind } from "./idIndex.js";
import { checkedIri, NAMESPACE_PATTERN } from "./iri.js";
import { mint, type Mintable } from "./mint.js";
import { localName } from "./name.js";
import { ObjectifiedFactType, type ObjectifiedFactTypeConfig } from "./ObjectifiedFactType.js";
import { createObjectType, type ObjectType, type ObjectTypeConfig } from "./ObjectType.js";
import { Population, type PopulationConfig } from "./Population.js";
import type { Role } from "./Role.js";
import { SubtypeFact, type SubtypeFactConfig, subtypePairKey } from "./SubtypeFact.js";

import type { ConstraintAdmission } from "./constraintAdmission.js";
import type { ConstraintInView, ConstraintModel } from "./constraintModel.js";
export type { ConstraintInView } from "./constraintModel.js";

/**
 * Configuration for creating a new OrmModel.
 */
export interface OrmModelConfig {
  readonly name: string;
  /** The bounded context this model represents. */
  readonly domainContext?: string;
  /** Free-text note: informal model-level commentary. */
  readonly note?: string;
  /**
   * The absolute IRI this model's element IRIs start with, for a model
   * outside a project that declares `iri_base` (`namespaceOf`,
   * iri-identity WS4). Ends in `/` or `#`.
   */
  readonly namespace?: string;
}

const quoted = (text: string): string => JSON.stringify(text);

/**
 * The ids within a fact type: its roles' and its constraints' (its own is
 * the store's to hold). One list for the add and the removal, so the
 * index takes and gives back the same ids.
 */
export function idsWithin(ft: FactType): [string | undefined, IdKind][] {
  return [
    ...ft.roles.map((r): [string, IdKind] => [r.id, "role"]),
    ...ft.internalConstraints.map((c): [string | undefined, IdKind] => [c.id, "constraint"]),
  ];
}

/**
 * Whether a fact type holds any of these roles: the one touch test behind
 * `constraintsTouchingAny`, `constraintsTouchingNone` and
 * `factTypesHolding` (so `factTypesOf` and `factTypesNaming`), so where a
 * constraint is listed and which fact types name it cannot disagree.
 */
function holdsAny(ft: FactType, roleIds: readonly string[]): boolean {
  return roleIds.some((rid) => ft.hasRole(rid));
}

export type { IdKeyedKind, IdKind } from "./idIndex.js";

/**
 * An `add*` was given an id its store already holds.
 *
 * Each store is a `Map` keyed by id, and `set` overwrites without a word,
 * so before this check a second element under a held id silently replaced
 * the first: an objectification evicted another in a merge, and a file
 * stating two fact types under one id loaded as one (model invariants,
 * WS3). The model cannot represent two elements under one id, so it
 * refuses rather than reports, whatever `skipPlayerValidation` says: that
 * option skips checks on what an element references, and this is a check
 * on the store itself. Both readers turn it into a `DeserializationError`.
 */
export class DuplicateIdError extends Error {
  constructor(
    readonly id: string,
    readonly kind: IdKeyedKind,
    held: string,
    adding: string,
  ) {
    super(`Id ${JSON.stringify(id)} is held by ${held}, so ${adding} cannot be added.`);
    this.name = "DuplicateIdError";
  }
}

/**
 * The root aggregate for an ORM model. Holds all object types, fact types,
 * and definitions, and provides query and mutation methods.
 *
 * The OrmModel enforces referential integrity: roles in fact types must
 * reference object types that exist in the model.
 */
export class OrmModel implements ConstraintModel {
  private _name: string;
  private _domainContext: string | undefined;
  private _note: string | undefined;
  private _namespace: string | undefined;

  /** Every id the stores hold, across kinds (`idIndex.ts`); each store keeps it. */
  private readonly _ids = new IdIndex();
  private readonly _objectTypes = new IdKeyedStore<ObjectType>("object type", this._ids);
  private readonly _factTypes = new IdKeyedStore<FactType>("fact type", this._ids);
  private readonly _subtypeFacts = new IdKeyedStore<SubtypeFact>("subtype fact", this._ids);
  private readonly _objectifiedFactTypes = new IdKeyedStore<ObjectifiedFactType>(
    "objectification",
    this._ids,
  );
  private readonly _populations = new IdKeyedStore<Population>("population", this._ids);
  /**
   * How a fact type in this model hands it a later constraint. Held here,
   * not exposed, so only a fact type this model added reaches the index.
   */
  private readonly _admission: ConstraintAdmission = {
    admitConstraint: <C extends InternalConstraint>(constraint: C, hostId: string): C => {
      // Only a fact type this model stores holds this admission; a host the
      // store does not map would be named as a constraint across fact types.
      const host = this._factTypes.get(hostId);
      if (host === undefined) {
        throw new Error(
          `Model "${this._name}" holds no fact type "${hostId}" to admit a constraint to.`,
        );
      }
      const stored = constraint.id === undefined
        ? {
          ...constraint,
          id: this.nameFor({ kind: "constraint", inView: [constraint, host] as ConstraintInView }),
        }
        : constraint;
      this._ids.hold(stored.id, "constraint");
      return stored;
    },
  };
  /**
   * The ids a load states, held back from minting while it runs
   * (`withReserved`), so a stated id wins wherever it sits in the file.
   */
  private _reserved: ReadonlySet<string> = new Set();
  private readonly _definitions: Definition[] = [];
  private readonly _diagramLayouts: DiagramLayout[] = [];
  private readonly _constraints: ExternalConstraint[] = [];
  /** Each entity's preferred identifier, by constraint id (orm-format-3 WS4b). */
  private readonly _preferredIdentifiers: Map<string, string> = new Map();

  constructor(config: OrmModelConfig) {
    if (!config.name || config.name.trim().length === 0) {
      throw new Error("Model name must be a non-empty string.");
    }
    this._name = config.name.trim();
    this._domainContext = config.domainContext;
    this._note = config.note;
    this._namespace = checkedIri(config.namespace, NAMESPACE_PATTERN, "namespace");
  }

  get name(): string {
    return this._name;
  }

  set name(value: string) {
    if (!value || value.trim().length === 0) {
      throw new Error("Model name must be a non-empty string.");
    }
    this._name = value.trim();
  }

  get domainContext(): string | undefined {
    return this._domainContext;
  }

  get note(): string | undefined {
    return this._note;
  }

  set note(value: string | undefined) {
    this._note = value;
  }

  set domainContext(value: string | undefined) {
    this._domainContext = value;
  }

  get namespace(): string | undefined {
    return this._namespace;
  }

  set namespace(value: string | undefined) {
    this._namespace = checkedIri(value, NAMESPACE_PATTERN, "namespace");
  }

  // ---- Object Types ----

  /** All object types in the model. */
  get objectTypes(): readonly ObjectType[] {
    return [...this._objectTypes.values()];
  }

  /** Look up an object type by id. */
  getObjectType(id: string): ObjectType | undefined {
    return this._objectTypes.get(id);
  }

  /** Look up an object type by name. */
  getObjectTypeByName(name: string): ObjectType | undefined {
    return this.objectTypes.find((ot) => ot.name === name);
  }

  /**
   * Throw `DuplicateIdError` when the store already holds the id a config
   * states. A config with no id gets a fresh one, which nothing holds.
   * `describe` reads both the held element and the config, so the message
   * names the two the same way.
   */
  private refuseHeldId<E, C extends { readonly id?: string; }>(
    store: { get(id: string): E | undefined; },
    config: C,
    kind: IdKeyedKind,
    describe: (element: E | C) => string,
  ): void {
    // Within the kind only: across kinds is format 4.0's rule, where
    // every id is a local name, and reads the id index (iri-identity 6b).
    const held = config.id === undefined ? undefined : store.get(config.id);
    if (held !== undefined) {
      throw new DuplicateIdError(config.id!, kind, describe(held), describe(config));
    }
  }

  /**
   * Run a load with the ids its file states reserved: a name minted while
   * it runs, for an element the file gives no id, skips them as it skips a
   * held id, so the element that states one takes it whether it comes
   * before or after (iri-identity WS6, "Mint at the add, with the file's
   * stated ids reserved for the load"). A stated id is still refused at
   * its own add if something already holds it. Reservations nest, and end
   * with the load, thrown or not.
   */
  withReserved<T>(ids: Iterable<string>, load: () => T): T {
    const before = this._reserved;
    this._reserved = new Set([...before, ...ids]);
    try {
      return load();
    } finally {
      this._reserved = before;
    }
  }

  /**
   * `base` when nothing in the model holds it, else the first of
   * `base_2`, `base_3`, ... that nothing holds: the suffix rule, across
   * every kind, because in format 4.0 a local name is unique in its model
   * (iri-identity WS6, 6b). The add order is the caller's, so the names a
   * load gives are a function of its input.
   */
  private mintedId(base: string, taken: ReadonlySet<string> = new Set()): string {
    const free = (id: string) => !this._ids.holds(id) && !this._reserved.has(id) && !taken.has(id);
    if (free(base)) return base;
    for (let n = 2;; n++) {
      if (free(`${base}_${n}`)) return `${base}_${n}`;
    }
  }

  /**
   * The id an element its sentence names takes: the minted name, under the
   * suffix rule (`mint.ts`). An element whose sentence would not be of it
   * -- a reference that dangles, a shape the sentence misreads -- is left
   * unnamed in format 4.0 (decisions 17 and 19); until 4.0 lets an id be
   * absent (6b-2b), it gets a generated id, because format 3.0 requires one.
   */
  private nameFor(element: Mintable): string {
    const minted = mint(element, this);
    return minted ? this.mintedId(minted.name) : generateId();
  }

  /** An object type by name where the model holds it, else by its id. */
  private objectTypeLabel(id: string): string {
    return quoted(this._objectTypes.get(id)?.name ?? id);
  }

  /** A fact type by name where the model holds it, else by its id. */
  private factTypeLabel(id: string): string {
    return quoted(this._factTypes.get(id)?.name ?? id);
  }

  /**
   * Add an object type to the model.
   * @throws DuplicateIdError if an object type with the same id already exists.
   * @throws If an object type with the same name already exists.
   */
  addObjectType(config: ObjectTypeConfig): ObjectType {
    this.refuseHeldId(
      this._objectTypes,
      config,
      "object type",
      (e) => `object type ${quoted(e.name)}`,
    );
    const existing = this.getObjectTypeByName(config.name);
    if (existing) {
      throw new Error(
        `Object type "${config.name}" already exists in model "${this._name}".`,
      );
    }
    const ot = createObjectType(
      config.id === undefined ? { ...config, id: this.mintedId(localName(config.name)) } : config,
    );
    this._objectTypes.set(ot);
    return ot;
  }

  /**
   * Remove an object type from the model.
   * @throws If any fact type references this object type.
   */
  removeObjectType(id: string): void {
    const ot = this._objectTypes.get(id);
    if (!ot) {
      throw new Error(`Object type with id "${id}" not found.`);
    }

    // Check for references from fact types.
    for (const ft of this._factTypes.values()) {
      for (const role of ft.roles) {
        if (role.playerId === id) {
          throw new Error(
            `Cannot remove object type "${ot.name}": it is referenced by `
              + `role "${role.name}" in fact type "${ft.name}".`,
          );
        }
      }
    }

    // Check for references from subtype facts.
    for (const sf of this._subtypeFacts.values()) {
      if (sf.subtypeId === id || sf.supertypeId === id) {
        throw new Error(
          `Cannot remove object type "${ot.name}": it is referenced by a subtype fact.`,
        );
      }
    }

    // Check for references from objectified fact types.
    for (const oft of this._objectifiedFactTypes.values()) {
      if (oft.objectTypeId === id) {
        throw new Error(
          `Cannot remove object type "${ot.name}": it is referenced by an objectified fact type.`,
        );
      }
    }

    this._objectTypes.delete(id);
    this._preferredIdentifiers.delete(id);
    this.pruneDiagramReferences(id);
  }

  // ---- Preferred identifiers ----

  /**
   * The id of the uniqueness constraint an entity names as its preferred
   * identifier, if it names one (orm-format-3, Open decision 3). Stored,
   * not inferred: `preferredIdentifiers` reads it, checks the constraint
   * identifies the entity, and every reader takes its answer from there.
   */
  preferredIdentifierOf(entityId: string): string | undefined {
    return this._preferredIdentifiers.get(entityId);
  }

  /**
   * Name an entity's preferred identifier, or clear it with `undefined`.
   * The constraint is not looked up: one that does not exist, or does not
   * identify the entity, is validation's to report, as a dangling role
   * is, so a merge or a lenient load can carry one through.
   * @throws If the object type does not exist or is not an entity type.
   */
  setPreferredIdentifier(entityId: string, constraintId: string | undefined): void {
    const ot = this._objectTypes.get(entityId);
    if (!ot) throw new Error(`Object type with id "${entityId}" not found.`);
    if (ot.kind !== "entity") {
      throw new Error(
        `"${ot.name}" is a ${ot.kind} type; only an entity type has a preferred identifier.`,
      );
    }
    if (constraintId === undefined) this._preferredIdentifiers.delete(entityId);
    else this._preferredIdentifiers.set(entityId, constraintId);
  }

  /** Every stored preferred identifier, as [entity id, constraint id], in insertion order. */
  get preferredIdentifierRefs(): readonly (readonly [string, string])[] {
    return [...this._preferredIdentifiers];
  }

  /** Clear every reference to a constraint that is gone. */
  private dropPreferredIdentifiersTo(constraintIds: ReadonlySet<string>): void {
    for (const [entityId, constraintId] of this._preferredIdentifiers) {
      if (constraintIds.has(constraintId)) this._preferredIdentifiers.delete(entityId);
    }
  }

  // ---- Fact Types ----

  /** All fact types in the model. */
  get factTypes(): readonly FactType[] {
    return [...this._factTypes.values()];
  }

  /** Look up a fact type by id. */
  getFactType(id: string): FactType | undefined {
    return this._factTypes.get(id);
  }

  // ---- Constraints ----

  /**
   * The constraints that live in the model: the external kinds, whose roles
   * may span fact types (orm-format-3, placement by kind), in the order they
   * were added. The 2.0 loader adds a file's after every fact type, in file
   * order: by the fact type nesting each, then by position.
   */
  get constraints(): readonly ExternalConstraint[] {
    return this._constraints;
  }

  /**
   * Add a constraint across fact types to the model, naming it by its
   * minted sentence when it has no id, as the model does for a fact type's
   * own (iri-identity, decision 17). Its roles are not checked: a lenient
   * load or a fragment can name a role the model does not hold, and
   * validation reports it.
   */
  addConstraint(constraint: ExternalConstraint): ExternalConstraint {
    const stored = constraint.id === undefined
      ? {
        ...constraint,
        id: this.nameFor({ kind: "constraint", inView: [constraint, undefined] }),
      }
      : constraint;
    this._constraints.push(stored);
    this._ids.hold(stored.id, "constraint");
    return stored;
  }

  /**
   * Remove a constraint across fact types by identity, as merge and the
   * fact type removal below need.
   */
  removeConstraint(constraint: ExternalConstraint): void {
    const i = this._constraints.indexOf(constraint);
    if (i >= 0) this.dropConstraintAt(i);
    if (constraint.id !== undefined) this.dropPreferredIdentifiersTo(new Set([constraint.id]));
  }

  /** Drop the constraint across fact types at `i`, and its id from the index. */
  private dropConstraintAt(i: number): void {
    const [dropped] = this._constraints.splice(i, 1);
    this._ids.release(dropped!.id, "constraint");
  }

  /**
   * The kinds whose elements hold `id`, sorted; empty when nothing does.
   * One id across kinds is allowed in format 3.0 and is a collision in
   * 4.0, where every id is a local name.
   */
  idKindsHolding(id: string): readonly IdKind[] {
    return this._ids.kindsHolding(id);
  }

  /**
   * Every constraint that applies to one fact type: its internal
   * constraints, then each model-level constraint naming one of its roles.
   * A constraint across fact types therefore appears under every fact type
   * it touches; a whole-model reader wants each fact type's
   * `internalConstraints` plus `constraints` once instead.
   *
   * Verbalization and counterexamples ask here by id, and query and
   * describe ask `constraintsTouchingAny`, which this is the one fact type
   * case of, so their views of one fact type cannot disagree. The answer is
   * about this model's fact type: a fact type it does not have touches
   * nothing here.
   */
  constraintsTouching(factTypeId: string): readonly Constraint[] {
    return this.constraintsTouchingAny([factTypeId]).map(([c]) => c);
  }

  /**
   * Each constraint id more than one constraint holds, with its holders in
   * `everyConstraint` order. A constraint id is model-wide -- another
   * element, another file, a diff or a merge names a constraint by it -- so
   * `structural/duplicate-constraint-id` reports these. The 3.0 loader
   * asks the same `groupRepeats` of the constraints the file states,
   * before building, since the id-keyed stores can drop a holder.
   */
  constraintsSharingAnId(): ReadonlyMap<string, readonly ConstraintInView[]> {
    return groupRepeats(this.everyConstraint(), ([c]) => c.id);
  }

  /**
   * Every constraint in the model, each once: each fact type's own
   * constraints in fact type order, then the constraints across fact types
   * (`constraints`). The whole-model view query and describe both list; a
   * view of some fact types is `constraintsTouchingAny`.
   */
  everyConstraint(): readonly ConstraintInView[] {
    return [
      ...this.factTypes.flatMap((ft) =>
        ft.internalConstraints.map((c): ConstraintInView => [c, ft])
      ),
      ...this.constraints.map((c): ConstraintInView => [c, undefined]),
    ];
  }

  /**
   * Every constraint touching any of these fact types, each once, in the
   * order given: each fact type's own constraints, then each constraint
   * across fact types touching it that an earlier one did not. The view of
   * an entity or of several fact types, so a constraint spanning two of
   * them is said once; `constraintsTouching` is the one fact type case.
   * Ids this model does not have touch nothing, and an id given twice adds
   * nothing the second time.
   */
  constraintsTouchingAny(factTypeIds: readonly string[]): readonly ConstraintInView[] {
    const across = this.constraints;
    const seen = new Set<Constraint>();
    const touching: ConstraintInView[] = [];
    for (const id of factTypeIds) {
      const ft = this._factTypes.get(id);
      if (!ft) continue;
      for (const c of ft.internalConstraints) {
        if (seen.has(c)) continue;
        seen.add(c);
        touching.push([c, ft]);
      }
      for (const c of across) {
        if (seen.has(c) || !holdsAny(ft, roleIdsOf(c))) continue;
        seen.add(c);
        touching.push([c, undefined]);
      }
    }
    return touching;
  }

  /**
   * The constraints across fact types that touch no fact type: none of
   * their roles resolve. No `constraintsTouchingAny` view lists them, so a
   * reader that shows constraints by fact type reads these too, or a
   * constraint left dangling by a renamed or deleted role disappears.
   * Both read the one `holdsAny` test, so a constraint is in exactly one
   * of this and some fact type's view. A constraint over subtypes names no
   * role; it is here only when none of its subtype facts resolve either,
   * since otherwise it belongs with the subtype facts it names
   * (orm-format-3 WS4b).
   */
  constraintsTouchingNone(): readonly ExternalConstraint[] {
    const factTypes = this.factTypes;
    return this.constraints.filter((c) => {
      if (isOverSubtypes(c)) {
        return !subtypeFactIdsOf(c).some((id) => this._subtypeFacts.has(id));
      }
      const roleIds = roleIdsOf(c);
      return !factTypes.some((ft) => holdsAny(ft, roleIds));
    });
  }

  /**
   * The fact types holding a constraint's roles, in model order: every
   * fact type a constraint across fact types spans. For an internal
   * constraint this is its own fact type only while its role ids resolve;
   * a stale one names nothing, which is why a constraint in a view is
   * named by `factTypesNaming` instead. Validation messages read this
   * directly, since they report what the roles say.
   */
  factTypesOf(constraint: Constraint): readonly FactType[] {
    return this.factTypesHolding(roleIdsOf(constraint));
  }

  /**
   * The fact types a constraint in a view is named by (orm-format-3, Open
   * decision 9): an internal constraint by the fact type it lives in, as
   * `constraintsTouching` lists it, and one across fact types by the fact
   * types it spans. The one answer verbalization rows and counterexamples
   * name a constraint by, so the two cannot disagree for one constraint.
   */
  factTypesNaming([constraint, factType]: ConstraintInView): readonly FactType[] {
    return factType ? [factType] : this.factTypesOf(constraint);
  }

  /**
   * The fact types holding any of these roles, in model order. A dangling
   * role id holds no fact type and adds none. `factTypesOf` is the answer
   * for a whole constraint; this is the one for some of its roles, as the
   * verbalizer's role labels need.
   */
  factTypesHolding(roleIds: readonly string[]): readonly FactType[] {
    return this.factTypes.filter((ft) => holdsAny(ft, roleIds));
  }

  /** Look up a constraint of either placement by id. */
  getConstraint(id: string): Constraint | undefined {
    return this.getConstraintInView(id)?.[0];
  }

  /**
   * Look up a constraint by id, with the fact type it lives in when it is
   * internal and none when it spans fact types: the pair a view names it
   * by (`factTypesNaming`), never the fact type a 2.0 file nests it under.
   */
  getConstraintInView(id: string): ConstraintInView | undefined {
    // A fact type's own constraints first, then the model's, stopping at
    // the first match. With an id given twice (barwise-b2s) an internal
    // constraint now wins over an external one, where file order used to
    // decide; the two placements are stored apart since WS3c.
    for (const ft of this._factTypes.values()) {
      const c = ft.internalConstraints.find((c) => c.id === id);
      if (c) return [c, ft];
    }
    const c = this._constraints.find((c) => c.id === id);
    return c ? [c, undefined] : undefined;
  }

  /** Look up a fact type by name. */
  getFactTypeByName(name: string): FactType | undefined {
    return this.factTypes.find((ft) => ft.name === name);
  }

  /**
   * Find a role by id anywhere in the model. A role belongs to a single
   * fact type, but a constraint (e.g. external uniqueness) can reference
   * roles across fact types, so resolution is model-wide.
   */
  findRole(id: string): Role | undefined {
    for (const ft of this.factTypes) {
      const role = ft.getRoleById(id);
      if (role) return role;
    }
    return undefined;
  }

  /**
   * Add a fact type to the model.
   * @param config - The fact type configuration.
   * @param options - Optional settings.
   * @param options.skipPlayerValidation - When true, skip the check that
   *   all role player IDs exist in the model.  Used when deserializing
   *   merge fragments that reference types from a base model.
   * @param options.suffixRepeatedRoleNames - When true, roles given one
   *   name and no ids take the suffix rule (`<ft>.is_in`, `<ft>.is_in_2`)
   *   instead of being refused: a migration or an import translating a
   *   source that names its roles alike (iri-identity, decision 5).
   * @throws If any role references a nonexistent object type (unless skipPlayerValidation).
   * @throws If two roles without ids share a name (unless suffixRepeatedRoleNames).
   * @throws DuplicateIdError if a fact type with the same id already exists.
   * @throws If a fact type with the same name already exists.
   */
  addFactType(
    config: FactTypeConfig,
    options?: { skipPlayerValidation?: boolean; suffixRepeatedRoleNames?: boolean; },
  ): FactType {
    this.refuseHeldId(this._factTypes, config, "fact type", (e) => `fact type ${quoted(e.name)}`);
    const existing = this.getFactTypeByName(config.name);
    if (existing) {
      throw new Error(
        `Fact type "${config.name}" already exists in model "${this._name}".`,
      );
    }

    // Validate that all role players exist.
    if (!options?.skipPlayerValidation) {
      for (const roleConfig of config.roles) {
        if (!this._objectTypes.has(roleConfig.playerId)) {
          throw new Error(
            `Role "${roleConfig.name}" in fact type "${config.name}" `
              + `references object type id "${roleConfig.playerId}" which `
              + `does not exist in the model.`,
          );
        }
      }
    }

    // Refused before anything is stored, as the constructor refused them.
    const constraints = (config.constraints ?? []).map((c) =>
      checkInternalConstraint(c, config.name)
    );
    // Every id the config states wins over a name minted in the same add
    // (decision 17): the fact type's and its roles' minted ids skip them,
    // and the stated constraint ids are held while the unnamed constraints
    // are named, then released for the admission's own hold.
    const statedConstraints = constraints.flatMap((c) => (c.id === undefined ? [] : [c.id]));
    const stated = new Set([
      ...config.roles.flatMap((r) => (r.id === undefined ? [] : [r.id])),
      ...statedConstraints,
    ]);
    const id = config.id ?? this.mintedId(localName(config.name), stated);
    const ft = new FactType({
      ...config,
      id,
      roles: this.namedRoles(
        config,
        id,
        new Set([...stated, id]),
        options?.suffixRepeatedRoleNames ?? false,
      ),
      constraints: [],
    });
    this._factTypes.set(ft);
    for (const [held, kind] of idsWithin(ft)) this._ids.hold(held, kind);
    ft.joinModel(this._admission);
    for (const held of statedConstraints) this._ids.hold(held, "constraint");
    // After the fact type is in, so each is named from its sentence, which
    // reads the fact type's players and readings.
    // Anything that throws here -- a constraint whose type was asserted and
    // is missing a field the sentence reads -- takes the fact type back out,
    // so a refused add leaves the model as it was, as it did when the
    // constructor refused it.
    try {
      for (const c of constraints) ft.addConstraint(c);
    } catch (err) {
      this.removeFactType(ft.id);
      throw err;
    } finally {
      for (const held of statedConstraints) this._ids.release(held, "constraint");
    }
    return ft;
  }

  /**
   * The roles with their ids: each its own, or `<fact type>.<role>`
   * (iri-identity, the role id rule). Two roles given without ids under one
   * name are refused, because neither id could say which role it is
   * (decision 5, for hand authoring); a file that repeats a name states its
   * role ids, and a migration or import asks for the suffix rule.
   */
  private namedRoles(
    config: FactTypeConfig,
    factTypeId: string,
    stated: ReadonlySet<string>,
    suffixRepeats: boolean,
  ): FactTypeConfig["roles"] {
    const unnamed = config.roles.filter((r) => r.id === undefined);
    for (
      const [local, roles] of suffixRepeats
        ? []
        : groupRepeats(unnamed, (r) => localName(r.name))
    ) {
      throw new Error(
        `Fact type "${config.name}" has ${roles.length} roles named "${roles[0]!.name}" `
          + `(${local}): give each role a name of its own, or state the role ids.`,
      );
    }
    const taken = new Set(stated);
    return config.roles.map((r) => {
      if (r.id !== undefined) return r;
      const id = this.mintedId(`${factTypeId}.${localName(r.name)}`, taken);
      taken.add(id);
      return { ...r, id };
    });
  }

  /**
   * Remove a fact type from the model.
   * @throws If an objectified fact type references this fact type.
   */
  removeFactType(id: string): void {
    const ft = this._factTypes.get(id);
    if (!ft) {
      throw new Error(`Fact type with id "${id}" not found.`);
    }

    // Check for references from objectified fact types.
    for (const oft of this._objectifiedFactTypes.values()) {
      if (oft.factTypeId === id) {
        throw new Error(
          `Cannot remove fact type "${ft.name}": it is referenced by an objectified fact type.`,
        );
      }
    }

    this._factTypes.delete(id);
    for (const [held, kind] of idsWithin(ft)) this._ids.release(held, kind);
    ft.leaveModel(this._admission);
    // An entity identified by one of its constraints is no longer: the
    // reference goes with the constraint, so a saved model does not name a
    // constraint that does not exist.
    this.dropPreferredIdentifiersTo(
      new Set(ft.internalConstraints.flatMap((c) => (c.id === undefined ? [] : [c.id]))),
    );
    // A constraint across fact types every role of which was here goes with
    // it. One that also spans another fact type stays, its roles here now
    // dangling, so validation reports it rather than a rule over the fact
    // types still present disappearing without a word; it used to go only
    // when a 2.0 file nested it here.
    // (A merge drops one it would leave dangling: there the removal is a
    // reviewed decision, and a dangling role would fail the merged model.)
    const within = (c: ExternalConstraint) => {
      const roles = roleIdsOf(c);
      return roles.length > 0 && roles.every((r) => ft.hasRole(r));
    };
    for (const c of this._constraints.filter(within)) this.removeConstraint(c);
    this.pruneDiagramReferences(id);
  }

  // ---- Subtype Facts ----

  /** All subtype facts in the model. */
  get subtypeFacts(): readonly SubtypeFact[] {
    return [...this._subtypeFacts.values()];
  }

  /** Look up a subtype fact by id. */
  getSubtypeFact(id: string): SubtypeFact | undefined {
    return this._subtypeFacts.get(id);
  }

  /**
   * Add a subtype fact to the model.
   * @param config - The subtype fact configuration.
   * @param options - Optional settings.
   * @param options.skipPlayerValidation - When true, skip the check that
   *   subtype/supertype IDs exist. Used for merge fragments.
   * @throws If subtype or supertype entity types don't exist (unless skipPlayerValidation).
   * @throws If either referenced object type is not an entity type (unless skipPlayerValidation).
   * @throws DuplicateIdError if a subtype fact with the same id already exists.
   * @throws If a duplicate subtype relationship already exists.
   */
  addSubtypeFact(
    config: SubtypeFactConfig,
    options?: { skipPlayerValidation?: boolean; },
  ): SubtypeFact {
    this.refuseHeldId(
      this._subtypeFacts,
      config,
      "subtype fact",
      (e) =>
        `subtype fact ${this.objectTypeLabel(e.subtypeId)} -> ${
          this.objectTypeLabel(e.supertypeId)
        }`,
    );
    const refusal = this.subtypeFactRefusal(config, options);
    if (refusal !== undefined) throw new Error(refusal);

    const sf = new SubtypeFact(
      config.id === undefined
        ? {
          ...config,
          id: this.nameFor({
            kind: "subtypeFact",
            subtypeFact: {
              id: "",
              subtypeId: config.subtypeId,
              supertypeId: config.supertypeId,
              definingRule: config.definingRule,
            },
          }),
        }
        : config,
    );
    this._subtypeFacts.set(sf);
    return sf;
  }

  /**
   * Whether `addSubtypeFact` would accept this pair with every check on,
   * including the one `SubtypeFact`'s constructor makes (the two ends
   * differ). Merge asks it before adding, so its pre-check and the store
   * read one predicate rather than two copies of it.
   */
  canAddSubtypeFact(config: Pick<SubtypeFactConfig, "subtypeId" | "supertypeId">): boolean {
    return config.subtypeId !== config.supertypeId
      && this.subtypeFactRefusal(config) === undefined;
  }

  /** Why `addSubtypeFact` refuses this pair, or nothing. */
  private subtypeFactRefusal(
    config: Pick<SubtypeFactConfig, "subtypeId" | "supertypeId">,
    options?: { skipPlayerValidation?: boolean; },
  ): string | undefined {
    if (options?.skipPlayerValidation) return undefined;
    const subtype = this._objectTypes.get(config.subtypeId);
    if (!subtype) {
      return `Subtype entity type id "${config.subtypeId}" does not exist in the model.`;
    }
    if (subtype.kind !== "entity") {
      return `Subtype "${subtype.name}" must be an entity type, not a ${subtype.kind} type.`;
    }
    const supertype = this._objectTypes.get(config.supertypeId);
    if (!supertype) {
      return `Supertype entity type id "${config.supertypeId}" does not exist in the model.`;
    }
    if (supertype.kind !== "entity") {
      return `Supertype "${supertype.name}" must be an entity type, not a ${supertype.kind} type.`;
    }
    const pair = subtypePairKey(config);
    for (const existing of this._subtypeFacts.values()) {
      if (subtypePairKey(existing) === pair) {
        return `Subtype relationship from "${subtype.name}" to "${supertype.name}" already exists.`;
      }
    }
    return undefined;
  }

  /**
   * Remove a subtype fact from the model, and keep of each constraint over
   * subtypes naming it only what still holds without it
   * (`withoutSubtypeFacts`). Not left dangling, as `removeFactType` leaves
   * a constraint's roles: a model holding an id that names nothing does not
   * load after its next save.
   */
  removeSubtypeFact(id: string): void {
    if (!this._subtypeFacts.has(id)) {
      throw new Error(`Subtype fact with id "${id}" not found.`);
    }
    this._subtypeFacts.delete(id);
    for (let i = this._constraints.length - 1; i >= 0; i--) {
      const kept = withoutSubtypeFacts(this._constraints[i]!, (sf) => sf === id);
      if (kept === undefined) this.dropConstraintAt(i);
      else this._constraints[i] = kept;
    }
  }

  /**
   * Get all direct supertypes of an entity type.
   * Returns the object types that the given entity is a subtype of.
   */
  supertypesOf(objectTypeId: string): readonly ObjectType[] {
    const result: ObjectType[] = [];
    for (const sf of this._subtypeFacts.values()) {
      if (sf.subtypeId === objectTypeId) {
        const supertype = this._objectTypes.get(sf.supertypeId);
        if (supertype) result.push(supertype);
      }
    }
    return result;
  }

  /**
   * Get all direct subtypes of an entity type.
   * Returns the object types that are subtypes of the given entity.
   */
  subtypesOf(objectTypeId: string): readonly ObjectType[] {
    const result: ObjectType[] = [];
    for (const sf of this._subtypeFacts.values()) {
      if (sf.supertypeId === objectTypeId) {
        const subtype = this._objectTypes.get(sf.subtypeId);
        if (subtype) result.push(subtype);
      }
    }
    return result;
  }

  // ---- Objectified Fact Types ----

  /** All objectified fact types in the model. */
  get objectifiedFactTypes(): readonly ObjectifiedFactType[] {
    return [...this._objectifiedFactTypes.values()];
  }

  /** Look up an objectified fact type by id. */
  getObjectifiedFactType(id: string): ObjectifiedFactType | undefined {
    return this._objectifiedFactTypes.get(id);
  }

  /**
   * Add an objectified fact type to the model.
   * @param config - The objectified fact type configuration.
   * @param options - Optional settings.
   * @param options.skipPlayerValidation - When true, skip the checks that
   *   the referenced fact type and object type exist. Used for lenient
   *   loads and merge fragments, as on `addFactType` and
   *   `addSubtypeFact`.
   * @throws If the referenced fact type does not exist (unless skipPlayerValidation).
   * @throws If the referenced object type does not exist or is not an entity (unless skipPlayerValidation).
   * @throws DuplicateIdError if an objectification with the same id already exists.
   * @throws If the fact type is already objectified.
   */
  addObjectifiedFactType(
    config: ObjectifiedFactTypeConfig,
    options?: { skipPlayerValidation?: boolean; },
  ): ObjectifiedFactType {
    this.refuseHeldId(
      this._objectifiedFactTypes,
      config,
      "objectification",
      (e) => `objectification of ${this.factTypeLabel(e.factTypeId)}`,
    );
    const refusal = this.objectificationRefusal(config, options);
    if (refusal !== undefined) throw new Error(refusal);

    const oft = new ObjectifiedFactType(
      config.id === undefined
        ? {
          ...config,
          id: this.nameFor({
            kind: "objectification",
            objectification: {
              id: "",
              factTypeId: config.factTypeId,
              objectTypeId: config.objectTypeId,
            },
          }),
        }
        : config,
    );
    this._objectifiedFactTypes.set(oft);
    return oft;
  }

  /**
   * Whether `addObjectifiedFactType` would accept this pair with every
   * check on, including the one `ObjectifiedFactType`'s constructor makes
   * (the two ids differ). Merge asks it before adding, as for subtype facts.
   */
  canAddObjectifiedFactType(
    config: Pick<ObjectifiedFactTypeConfig, "factTypeId" | "objectTypeId">,
  ): boolean {
    return config.factTypeId !== config.objectTypeId
      && this.objectificationRefusal(config) === undefined;
  }

  /** Why `addObjectifiedFactType` refuses this pair, or nothing. */
  private objectificationRefusal(
    config: Pick<ObjectifiedFactTypeConfig, "factTypeId" | "objectTypeId">,
    options?: { skipPlayerValidation?: boolean; },
  ): string | undefined {
    const factType = this._factTypes.get(config.factTypeId);
    const objectType = this._objectTypes.get(config.objectTypeId);
    if (!options?.skipPlayerValidation) {
      if (!factType) return `Fact type id "${config.factTypeId}" does not exist in the model.`;
      if (!objectType) {
        return `Object type id "${config.objectTypeId}" does not exist in the model.`;
      }
      if (objectType.kind !== "entity") {
        return `Object type "${objectType.name}" must be an entity type, not a ${objectType.kind} type.`;
      }
    }
    // Duplicate objectification is a property of THIS model's own
    // records, not of what they reference, so it is checked either way.
    // The names fall back to the ids because a skipped load may not have
    // the elements to name.
    for (const existing of this._objectifiedFactTypes.values()) {
      if (existing.factTypeId === config.factTypeId) {
        return `Fact type "${factType?.name ?? config.factTypeId}" is already objectified.`;
      }
    }
    for (const existing of this._objectifiedFactTypes.values()) {
      if (existing.objectTypeId === config.objectTypeId) {
        return `Object type "${
          objectType?.name ?? config.objectTypeId
        }" is already used as an objectification.`;
      }
    }
    return undefined;
  }

  /** Remove an objectified fact type from the model. */
  removeObjectifiedFactType(id: string): void {
    if (!this._objectifiedFactTypes.has(id)) {
      throw new Error(`Objectified fact type with id "${id}" not found.`);
    }
    this._objectifiedFactTypes.delete(id);
  }

  /**
   * Get the objectified fact type for a given fact type, if any.
   * Returns undefined if the fact type is not objectified.
   */
  objectificationOf(factTypeId: string): ObjectifiedFactType | undefined {
    for (const oft of this._objectifiedFactTypes.values()) {
      if (oft.factTypeId === factTypeId) return oft;
    }
    return undefined;
  }

  /**
   * Get the objectified fact type for a given entity type, if any.
   * Returns undefined if the entity type is not an objectification.
   */
  objectificationFor(objectTypeId: string): ObjectifiedFactType | undefined {
    for (const oft of this._objectifiedFactTypes.values()) {
      if (oft.objectTypeId === objectTypeId) return oft;
    }
    return undefined;
  }

  // ---- Populations ----

  /** All populations in the model. */
  get populations(): readonly Population[] {
    return [...this._populations.values()];
  }

  /** Look up a population by id. */
  getPopulation(id: string): Population | undefined {
    return this._populations.get(id);
  }

  /**
   * Get all populations for a given fact type.
   */
  populationsForFactType(factTypeId: string): readonly Population[] {
    const result: Population[] = [];
    for (const pop of this._populations.values()) {
      if (pop.factTypeId === factTypeId) result.push(pop);
    }
    return result;
  }

  /**
   * Add a population to the model.
   * @param options - Optional settings.
   * @param options.skipPlayerValidation - When true, skip the check that
   *   the referenced fact type exists. Used for lenient loads, as on
   *   `addFactType` and `addSubtypeFact`.
   * @throws DuplicateIdError if a population with the same id already exists.
   * @throws If the referenced fact type does not exist (unless skipPlayerValidation).
   */
  addPopulation(
    config: PopulationConfig,
    options?: { skipPlayerValidation?: boolean; },
  ): Population {
    this.refuseHeldId(
      this._populations,
      config,
      "population",
      (e) => `population of fact type ${this.factTypeLabel(e.factTypeId)}`,
    );
    if (!options?.skipPlayerValidation && !this._factTypes.get(config.factTypeId)) {
      throw new Error(
        `Fact type id "${config.factTypeId}" does not exist in the model.`,
      );
    }
    // Its fact type's id and `.population`, under the suffix rule (decision 7).
    const pop = new Population(
      config.id === undefined
        ? { ...config, id: this.mintedId(`${config.factTypeId}.population`) }
        : config,
    );
    this._populations.set(pop);
    return pop;
  }

  /** Remove a population from the model. */
  removePopulation(id: string): void {
    if (!this._populations.has(id)) {
      throw new Error(`Population with id "${id}" not found.`);
    }
    this._populations.delete(id);
  }

  // ---- Definitions ----

  /** All ubiquitous language definitions. */
  get definitions(): readonly Definition[] {
    return [...this._definitions];
  }

  /** Add a ubiquitous language definition. */
  addDefinition(definition: Definition): void {
    if (!definition.term || definition.term.trim().length === 0) {
      throw new Error("Definition term must be a non-empty string.");
    }
    if (!definition.definition || definition.definition.trim().length === 0) {
      throw new Error("Definition text must be a non-empty string.");
    }
    this._definitions.push(definition);
  }

  // ---- Diagram Layouts ----

  /** All persisted diagram layouts. */
  get diagramLayouts(): readonly DiagramLayout[] {
    return [...this._diagramLayouts];
  }

  /** Look up a diagram layout by name. */
  getDiagramLayout(name: string): DiagramLayout | undefined {
    return this._diagramLayouts.find((d) => d.name === name);
  }

  /** Add a diagram layout. @throws If a layout with the same name already exists. */
  addDiagramLayout(layout: DiagramLayout): void {
    if (!layout.name || layout.name.trim().length === 0) {
      throw new Error("Diagram layout name must be a non-empty string.");
    }
    if (this._diagramLayouts.some((d) => d.name === layout.name)) {
      throw new Error(
        `Diagram layout "${layout.name}" already exists in model "${this._name}".`,
      );
    }
    this._diagramLayouts.push(layout);
  }

  /** Replace an existing diagram layout (matched by name). */
  updateDiagramLayout(layout: DiagramLayout): void {
    const idx = this._diagramLayouts.findIndex((d) => d.name === layout.name);
    if (idx === -1) {
      throw new Error(`Diagram layout "${layout.name}" not found.`);
    }
    this._diagramLayouts[idx] = layout;
  }

  /**
   * Drop a removed element's id from every layout. Conceptual references
   * make a removal throw; a diagram entry is presentation, so it follows
   * the element out rather than blocking it or dangling.
   */
  private pruneDiagramReferences(id: string): void {
    for (let i = 0; i < this._diagramLayouts.length; i++) {
      const layout = this._diagramLayouts[i]!;
      const mentions = layout.elements?.includes(id)
        || id in layout.positions
        || id in layout.orientations;
      if (!mentions) continue;
      this._diagramLayouts[i] = withoutDiagramReferences(layout, (ref) => ref === id);
    }
  }

  /** Remove a diagram layout by name. */
  removeDiagramLayout(name: string): void {
    const idx = this._diagramLayouts.findIndex((d) => d.name === name);
    if (idx === -1) {
      throw new Error(`Diagram layout "${name}" not found.`);
    }
    this._diagramLayouts.splice(idx, 1);
  }

  // ---- Queries ----

  /** Get all fact types that a given object type participates in. */
  factTypesForObjectType(objectTypeId: string): readonly FactType[] {
    return this.factTypes.filter((ft) => ft.roles.some((r) => r.playerId === objectTypeId));
  }

  /** Count of all elements in the model. */
  get elementCount(): number {
    return (
      this._objectTypes.size
      + this._factTypes.size
      + this._subtypeFacts.size
      + this._objectifiedFactTypes.size
      + this._populations.size
      + this._definitions.length
      + this._diagramLayouts.length
    );
  }
}
