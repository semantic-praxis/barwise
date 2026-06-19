import type { Definition } from "./Definition.js";
import type { DiagramLayout } from "./DiagramLayout.js";
import { FactType, type FactTypeConfig } from "./FactType.js";
import { ObjectifiedFactType, type ObjectifiedFactTypeConfig } from "./ObjectifiedFactType.js";
import { ObjectType, type ObjectTypeConfig } from "./ObjectType.js";
import { Population, type PopulationConfig } from "./Population.js";
import type { Role } from "./Role.js";
import { SubtypeFact, type SubtypeFactConfig } from "./SubtypeFact.js";

/**
 * Configuration for creating a new OrmModel.
 */
export interface OrmModelConfig {
  readonly name: string;
  /** The bounded context this model represents. */
  readonly domainContext?: string;
  /** Free-text note: informal model-level commentary. */
  readonly note?: string;
}

/**
 * The root aggregate for an ORM model. Holds all object types, fact types,
 * and definitions, and provides query and mutation methods.
 *
 * The OrmModel enforces referential integrity: roles in fact types must
 * reference object types that exist in the model.
 */
export class OrmModel {
  private _name: string;
  private _domainContext: string | undefined;
  private _note: string | undefined;

  private readonly _objectTypes: Map<string, ObjectType> = new Map();
  private readonly _factTypes: Map<string, FactType> = new Map();
  private readonly _subtypeFacts: Map<string, SubtypeFact> = new Map();
  private readonly _objectifiedFactTypes: Map<string, ObjectifiedFactType> = new Map();
  private readonly _populations: Map<string, Population> = new Map();
  private readonly _definitions: Definition[] = [];
  private readonly _diagramLayouts: DiagramLayout[] = [];

  constructor(config: OrmModelConfig) {
    if (!config.name || config.name.trim().length === 0) {
      throw new Error("Model name must be a non-empty string.");
    }
    this._name = config.name.trim();
    this._domainContext = config.domainContext;
    this._note = config.note;
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
   * Add an object type to the model.
   * @throws If an object type with the same name already exists.
   */
  addObjectType(config: ObjectTypeConfig): ObjectType {
    const existing = this.getObjectTypeByName(config.name);
    if (existing) {
      throw new Error(
        `Object type "${config.name}" already exists in model "${this._name}".`,
      );
    }
    const ot = new ObjectType(config);
    this._objectTypes.set(ot.id, ot);
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
   * @throws If any role references a nonexistent object type (unless skipPlayerValidation).
   * @throws If a fact type with the same name already exists.
   */
  addFactType(
    config: FactTypeConfig,
    options?: { skipPlayerValidation?: boolean; },
  ): FactType {
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

    const ft = new FactType(config);
    this._factTypes.set(ft.id, ft);
    return ft;
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
   * @throws If a duplicate subtype relationship already exists.
   */
  addSubtypeFact(
    config: SubtypeFactConfig,
    options?: { skipPlayerValidation?: boolean; },
  ): SubtypeFact {
    if (!options?.skipPlayerValidation) {
      const subtype = this._objectTypes.get(config.subtypeId);
      if (!subtype) {
        throw new Error(
          `Subtype entity type id "${config.subtypeId}" does not exist in the model.`,
        );
      }
      if (subtype.kind !== "entity") {
        throw new Error(
          `Subtype "${subtype.name}" must be an entity type, not a ${subtype.kind} type.`,
        );
      }

      const supertype = this._objectTypes.get(config.supertypeId);
      if (!supertype) {
        throw new Error(
          `Supertype entity type id "${config.supertypeId}" does not exist in the model.`,
        );
      }
      if (supertype.kind !== "entity") {
        throw new Error(
          `Supertype "${supertype.name}" must be an entity type, not a ${supertype.kind} type.`,
        );
      }

      // Check for duplicate subtype relationship.
      for (const existing of this._subtypeFacts.values()) {
        if (
          existing.subtypeId === config.subtypeId
          && existing.supertypeId === config.supertypeId
        ) {
          throw new Error(
            `Subtype relationship from "${subtype.name}" to "${supertype.name}" already exists.`,
          );
        }
      }
    }

    const sf = new SubtypeFact(config);
    this._subtypeFacts.set(sf.id, sf);
    return sf;
  }

  /** Remove a subtype fact from the model. */
  removeSubtypeFact(id: string): void {
    if (!this._subtypeFacts.has(id)) {
      throw new Error(`Subtype fact with id "${id}" not found.`);
    }
    this._subtypeFacts.delete(id);
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
   * @throws If the referenced fact type does not exist.
   * @throws If the referenced object type does not exist or is not an entity.
   * @throws If the fact type is already objectified.
   */
  addObjectifiedFactType(
    config: ObjectifiedFactTypeConfig,
  ): ObjectifiedFactType {
    const factType = this._factTypes.get(config.factTypeId);
    if (!factType) {
      throw new Error(
        `Fact type id "${config.factTypeId}" does not exist in the model.`,
      );
    }

    const objectType = this._objectTypes.get(config.objectTypeId);
    if (!objectType) {
      throw new Error(
        `Object type id "${config.objectTypeId}" does not exist in the model.`,
      );
    }
    if (objectType.kind !== "entity") {
      throw new Error(
        `Object type "${objectType.name}" must be an entity type, not a ${objectType.kind} type.`,
      );
    }

    // Check that the fact type is not already objectified.
    for (const existing of this._objectifiedFactTypes.values()) {
      if (existing.factTypeId === config.factTypeId) {
        throw new Error(
          `Fact type "${factType.name}" is already objectified.`,
        );
      }
    }

    // Check that the object type is not already used as an objectification.
    for (const existing of this._objectifiedFactTypes.values()) {
      if (existing.objectTypeId === config.objectTypeId) {
        throw new Error(
          `Object type "${objectType.name}" is already used as an objectification.`,
        );
      }
    }

    const oft = new ObjectifiedFactType(config);
    this._objectifiedFactTypes.set(oft.id, oft);
    return oft;
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
   * @throws If the referenced fact type does not exist.
   */
  addPopulation(config: PopulationConfig): Population {
    const factType = this._factTypes.get(config.factTypeId);
    if (!factType) {
      throw new Error(
        `Fact type id "${config.factTypeId}" does not exist in the model.`,
      );
    }
    const pop = new Population(config);
    this._populations.set(pop.id, pop);
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
