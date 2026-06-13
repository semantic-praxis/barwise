import { randomUUID } from "node:crypto";
import type { Constraint } from "./Constraint.js";
import { ModelElement } from "./ModelElement.js";
import { type ReadingOrder, validateReadingTemplate } from "./ReadingOrder.js";
import { Role, type RoleConfig } from "./Role.js";

/**
 * Configuration for creating a new FactType.
 */
export interface FactTypeConfig {
  readonly name: string;
  readonly id?: string;
  readonly roles: readonly RoleConfig[];
  readonly readings: readonly string[];
  readonly constraints?: readonly Constraint[];
  /** Natural-language definition. */
  readonly definition?: string;
}

/**
 * A FactType is a relationship between object types, expressed as a set
 * of ordered roles. Binary fact types are the most common, but unary,
 * ternary, and higher-arity fact types are supported.
 *
 * Each fact type has at least one reading order (a natural-language template
 * for verbalization). Constraints encode business rules about the fact type's
 * population.
 */
export class FactType extends ModelElement {
  private readonly _roles: Role[];
  private readonly _readings: ReadingOrder[];
  private readonly _constraints: Constraint[];
  private _definition: string | undefined;

  constructor(config: FactTypeConfig) {
    super(config.name, config.id);

    if (config.roles.length === 0) {
      throw new Error(
        `Fact type "${config.name}" must have at least one role.`,
      );
    }

    if (config.readings.length === 0) {
      throw new Error(
        `Fact type "${config.name}" must have at least one reading.`,
      );
    }

    this._roles = config.roles.map((rc) => new Role(rc));

    // Validate reading templates against role count.
    const errors: string[] = [];
    for (const template of config.readings) {
      errors.push(
        ...validateReadingTemplate(template, this._roles.length),
      );
    }
    if (errors.length > 0) {
      throw new Error(
        `Invalid readings for fact type "${config.name}": ${errors.join("; ")}`,
      );
    }

    this._readings = config.readings.map((template) => ({ template }));
    // Assign IDs to constraints that don't have them (for traceability).
    this._constraints = (config.constraints ?? []).map((c) =>
      c.id ? c : { ...c, id: randomUUID() }
    );
    this._definition = config.definition;
  }

  /** The ordered roles in this fact type. */
  get roles(): readonly Role[] {
    return this._roles;
  }

  /** The reading orders (verbalization templates). */
  get readings(): readonly ReadingOrder[] {
    return this._readings;
  }

  /** The constraints on this fact type. */
  get constraints(): readonly Constraint[] {
    return this._constraints;
  }

  /** The arity (number of roles). */
  get arity(): number {
    return this._roles.length;
  }

  get definition(): string | undefined {
    return this._definition;
  }

  set definition(value: string | undefined) {
    this._definition = value;
  }

  /** Find a role by its id. Returns undefined if not found. */
  getRoleById(roleId: string): Role | undefined {
    return this._roles.find((r) => r.id === roleId);
  }

  /** Check whether a role id belongs to this fact type. */
  hasRole(roleId: string): boolean {
    return this._roles.some((r) => r.id === roleId);
  }

  /** Add a constraint to this fact type. */
  addConstraint(constraint: Constraint): void {
    this._constraints.push(constraint);
  }

  /** Get all role ids that reference a given object type (by player id). */
  rolesForPlayer(playerId: string): readonly Role[] {
    return this._roles.filter((r) => r.playerId === playerId);
  }
}
