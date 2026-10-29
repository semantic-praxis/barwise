import type { Constraint } from "../../src/model/Constraint.js";
import { storePreferredFlags } from "../../src/model/identification.js";
import type {
  DataTypeDef,
  ObjectTypeKind,
  ValueConstraintDef,
} from "../../src/model/ObjectType.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import type { FactInstanceConfig } from "../../src/model/Population.js";

/**
 * The id the builder gives a binary fact type's role, by its position (1 or
 * 2, as `role1` and `role2` name them). A test that names a role by id
 * calls this, so the format is decided here. It avoids `:`, which format
 * 4.0 reserves for an alias, and keeps the fact type's name as written, so
 * two fact types whose names differ give different ids. The `#` is one
 * `localName` always encodes, so a builder id never reads as a 4.0 id
 * (iri-identity, WS6 6a).
 */
export function roleId(factTypeName: string, position: 1 | 2): string {
  return `${factTypeName}#role${position}`;
}

/** The id of the uniqueness a fact type's `isPreferred` flags. */
export function preferredId(factTypeName: string): string {
  return `${factTypeName}#preferred`;
}

/**
 * Shorthand options for adding an object type via the builder.
 */
interface ObjectTypeOptions {
  kind?: ObjectTypeKind;
  referenceMode?: string;
  definition?: string;
  sourceContext?: string;
  valueConstraint?: ValueConstraintDef;
  dataType?: DataTypeDef;
  aliases?: string[];
  defaultValue?: string;
}

/**
 * Shorthand options for a role in a binary fact type.
 */
interface RoleShorthand {
  player: string; // object type NAME (resolved to id by the builder)
  name: string;
}

/**
 * Shorthand options for adding a binary fact type via the builder.
 */
interface BinaryFactTypeOptions {
  role1: RoleShorthand;
  role2: RoleShorthand;
  readings?: [string, string];
  /** Shorthand: "role1" or "role2" for single-role internal uniqueness. */
  uniqueness?: "role1" | "role2" | "both" | "spanning";
  /** Shorthand: "role1" or "role2" for mandatory role constraint. */
  mandatory?: "role1" | "role2" | "both";
  /**
   * Mark the uniqueness constraint as a preferred identifier, as a 2.0
   * file's `is_preferred` flag would: `build` places it on the entity it
   * identifies with the 2.0 loader's rule (`storePreferredFlags`).
   */
  isPreferred?: boolean;
  definition?: string;
}

/**
 * Fluent builder for constructing OrmModel instances in tests.
 *
 * Designed to minimize boilerplate while producing fully valid models.
 * Names are used as identifiers in the builder API; actual UUIDs are
 * assigned by the underlying model classes.
 *
 * @example
 * ```ts
 * const model = new ModelBuilder("Order Management")
 *   .withEntityType("Customer", { referenceMode: "customer_id" })
 *   .withEntityType("Order", { referenceMode: "order_number" })
 *   .withBinaryFactType("Customer places Order", {
 *     role1: { player: "Customer", name: "places" },
 *     role2: { player: "Order", name: "is placed by" },
 *     uniqueness: "role2",
 *     mandatory: "role2",
 *   })
 *   .build();
 * ```
 */
export class ModelBuilder {
  private readonly modelName: string;
  private readonly domainContext?: string;
  private readonly objectTypeConfigs: Array<{
    name: string;
    options: ObjectTypeOptions;
  }> = [];
  private readonly factTypeConfigs: Array<{
    name: string;
    options: BinaryFactTypeOptions;
  }> = [];
  private readonly subtypeFactConfigs: Array<{
    subtypeName: string;
    supertypeName: string;
    providesIdentification?: boolean;
  }> = [];
  private readonly objectifiedFactTypeConfigs: Array<{
    factTypeName: string;
    objectTypeName: string;
  }> = [];
  private readonly populationConfigs: Array<{
    sample?: boolean;
    factTypeName: string;
    description?: string;
    instances: FactInstanceConfig[];
  }> = [];
  private readonly definitionConfigs: Array<{
    term: string;
    definition: string;
    context?: string;
  }> = [];

  constructor(modelName: string = "Test Model", domainContext?: string) {
    this.modelName = modelName;
    this.domainContext = domainContext;
  }

  /**
   * Add an entity type (identified by a reference mode).
   */
  withEntityType(
    name: string,
    options: Omit<ObjectTypeOptions, "kind"> = {},
  ): this {
    this.objectTypeConfigs.push({
      name,
      options: {
        ...options,
        kind: "entity",
        referenceMode: options.referenceMode ?? `${name.toLowerCase()}_id`,
      },
    });
    return this;
  }

  /**
   * Add a value type (self-identifying).
   */
  withValueType(
    name: string,
    options: Omit<ObjectTypeOptions, "kind" | "referenceMode"> = {},
  ): this {
    this.objectTypeConfigs.push({
      name,
      options: { ...options, kind: "value" },
    });
    return this;
  }

  /**
   * Add a binary fact type between two object types.
   *
   * Object types must have been declared before calling this method
   * (via withEntityType or withValueType).
   */
  withBinaryFactType(name: string, options: BinaryFactTypeOptions): this {
    this.factTypeConfigs.push({ name, options });
    return this;
  }

  /**
   * Add a subtype relationship between two entity types.
   *
   * Both entity types must have been declared before calling this method.
   */
  withSubtypeFact(
    subtypeName: string,
    supertypeName: string,
    options: { providesIdentification?: boolean; } = {},
  ): this {
    this.subtypeFactConfigs.push({
      subtypeName,
      supertypeName,
      providesIdentification: options.providesIdentification,
    });
    return this;
  }

  /**
   * Objectify a fact type as an entity type.
   *
   * Both the fact type and entity type must have been declared before
   * calling this method.
   */
  withObjectifiedFactType(
    factTypeName: string,
    objectTypeName: string,
  ): this {
    this.objectifiedFactTypeConfigs.push({ factTypeName, objectTypeName });
    return this;
  }

  /**
   * Add a population with sample instances for a fact type.
   *
   * Instance values use the builder's deterministic role IDs:
   * `roleId(name, 1)` and `roleId(name, 2)`.
   */
  withPopulation(
    factTypeName: string,
    instances: FactInstanceConfig[],
    description?: string,
  ): this {
    this.populationConfigs.push({ factTypeName, instances, description });
    return this;
  }

  /**
   * Add a population marked as an illustrative sample rather than the
   * complete extension of the fact type. Its instances are positive
   * evidence only -- they can satisfy a constraint but never create the
   * obligation that one be satisfied.
   */
  withSamplePopulation(
    factTypeName: string,
    instances: FactInstanceConfig[],
    description?: string,
  ): this {
    this.populationConfigs.push({ factTypeName, instances, description, sample: true });
    return this;
  }

  /**
   * Add a ubiquitous language definition.
   */
  withDefinition(
    term: string,
    definition: string,
    context?: string,
  ): this {
    this.definitionConfigs.push({ term, definition, context });
    return this;
  }

  /**
   * Build and return the OrmModel.
   * @throws If any referenced object types don't exist.
   */
  build(): OrmModel {
    // The flagged uniqueness of each fact type, by the id it is given.
    const flagged = new Set<string>();
    const flag = (factTypeName: string) => {
      const id = preferredId(factTypeName);
      flagged.add(id);
      return id;
    };
    const model = new OrmModel({
      name: this.modelName,
      domainContext: this.domainContext,
    });

    // Add all object types first.
    for (const { name, options } of this.objectTypeConfigs) {
      model.addObjectType({
        name,
        kind: options.kind ?? "entity",
        referenceMode: options.referenceMode,
        definition: options.definition,
        sourceContext: options.sourceContext,
        valueConstraint: options.valueConstraint,
        dataType: options.dataType,
        aliases: options.aliases,
        defaultValue: options.defaultValue,
      });
    }

    // Add all fact types (which reference object types by name).
    for (const { name, options } of this.factTypeConfigs) {
      const player1 = model.getObjectTypeByName(options.role1.player);
      if (!player1) {
        throw new Error(
          `ModelBuilder: object type "${options.role1.player}" not found `
            + `when building fact type "${name}".`,
        );
      }

      const player2 = model.getObjectTypeByName(options.role2.player);
      if (!player2) {
        throw new Error(
          `ModelBuilder: object type "${options.role2.player}" not found `
            + `when building fact type "${name}".`,
        );
      }

      // Generate default readings if not provided.
      const readings = options.readings ?? [
        `{0} ${options.role1.name} {1}`,
        `{1} ${options.role2.name} {0}`,
      ];

      // Build constraints from shorthand.
      const constraints: Constraint[] = [];

      // We need to generate role ids ahead of time so constraints can reference them.
      // We use deterministic ids based on fact type name + position.
      const role1Id = roleId(name, 1);
      const role2Id = roleId(name, 2);

      if (options.uniqueness) {
        const preferred = options.isPreferred ?? false;
        switch (options.uniqueness) {
          case "role1":
            constraints.push({
              type: "internal_uniqueness",
              roleIds: [role1Id],
              ...(preferred ? { id: flag(name) } : {}),
            });
            break;
          case "role2":
            constraints.push({
              type: "internal_uniqueness",
              roleIds: [role2Id],
              ...(preferred ? { id: flag(name) } : {}),
            });
            break;
          case "both":
            // A preferred flag goes on role1, as "role1" puts it; an
            // entity-value binary is identified whichever role carries it.
            constraints.push({
              type: "internal_uniqueness",
              roleIds: [role1Id],
              ...(preferred ? { id: flag(name) } : {}),
            });
            constraints.push({
              type: "internal_uniqueness",
              roleIds: [role2Id],
            });
            break;
          case "spanning":
            constraints.push({
              type: "internal_uniqueness",
              roleIds: [role1Id, role2Id],
              ...(preferred ? { id: flag(name) } : {}),
            });
            break;
        }
      }

      if (options.mandatory) {
        switch (options.mandatory) {
          case "role1":
            constraints.push({ type: "mandatory", roleId: role1Id });
            break;
          case "role2":
            constraints.push({ type: "mandatory", roleId: role2Id });
            break;
          case "both":
            constraints.push({ type: "mandatory", roleId: role1Id });
            constraints.push({ type: "mandatory", roleId: role2Id });
            break;
        }
      }

      model.addFactType({
        name,
        roles: [
          { name: options.role1.name, playerId: player1.id, id: role1Id },
          { name: options.role2.name, playerId: player2.id, id: role2Id },
        ],
        readings,
        constraints,
        definition: options.definition,
      });
    }

    // Add subtype facts (which reference object types by name).
    for (const { subtypeName, supertypeName, providesIdentification } of this.subtypeFactConfigs) {
      const subtype = model.getObjectTypeByName(subtypeName);
      if (!subtype) {
        throw new Error(
          `ModelBuilder: object type "${subtypeName}" not found `
            + `when building subtype fact.`,
        );
      }
      const supertype = model.getObjectTypeByName(supertypeName);
      if (!supertype) {
        throw new Error(
          `ModelBuilder: object type "${supertypeName}" not found `
            + `when building subtype fact.`,
        );
      }
      model.addSubtypeFact({
        subtypeId: subtype.id,
        supertypeId: supertype.id,
        providesIdentification,
      });
    }

    // Add objectified fact types (which reference fact types and object types by name).
    for (const { factTypeName, objectTypeName } of this.objectifiedFactTypeConfigs) {
      const factType = model.getFactTypeByName(factTypeName);
      if (!factType) {
        throw new Error(
          `ModelBuilder: fact type "${factTypeName}" not found `
            + `when building objectified fact type.`,
        );
      }
      const objectType = model.getObjectTypeByName(objectTypeName);
      if (!objectType) {
        throw new Error(
          `ModelBuilder: object type "${objectTypeName}" not found `
            + `when building objectified fact type.`,
        );
      }
      model.addObjectifiedFactType({
        factTypeId: factType.id,
        objectTypeId: objectType.id,
      });
    }

    // Add populations (which reference fact types by name).
    for (const { factTypeName, instances, description, sample } of this.populationConfigs) {
      const factType = model.getFactTypeByName(factTypeName);
      if (!factType) {
        throw new Error(
          `ModelBuilder: fact type "${factTypeName}" not found `
            + `when building population.`,
        );
      }
      const pop = model.addPopulation({
        factTypeId: factType.id,
        description,
        ...(sample === true ? { sample: true } : {}),
      });
      for (const inst of instances) {
        pop.addInstance(inst);
      }
    }

    // Add definitions.
    for (const def of this.definitionConfigs) {
      model.addDefinition(def);
    }

    // After the objectifications: an objectified fact type's flag names
    // the objectifying type.
    storePreferredFlags(model, (c) => c.id !== undefined && flagged.has(c.id));
    return model;
  }
}
