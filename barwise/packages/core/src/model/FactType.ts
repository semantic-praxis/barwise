import { randomUUID } from "node:crypto";
import type { Constraint } from "./Constraint.js";
import { ModelElement } from "./ModelElement.js";
import { type ReadingOrder, validateReadingTemplate } from "./ReadingOrder.js";
import { Role, type RoleConfig } from "./Role.js";

/**
 * The definitional axis of a derived element: `derived` (`*`, fully defined
 * by the rule) or `semiderived` (`+`, a partial/conditional definition). An
 * asserted (base) fact type has no derivation at all.
 */
export type DerivationKind = "derived" | "semiderived";

/**
 * The storage axis of a derived element, orthogonal to the definitional
 * axis: `derive_on_request` (`*`, computed on demand, the default) or
 * `derived_and_stored` (`**`, eagerly materialized).
 */
export type DerivationStorage = "derive_on_request" | "derived_and_stored";

/**
 * A derivation rule: how a derived fact type's (or subtype's) population is
 * defined. In v1 the rule is informal -- opaque text carried verbatim and
 * verbalized, never parsed or executed by core (ADR-0001 filter 3). The
 * `isFormal` flag is reserved for a future formal grammar; it is absent or
 * false in v1.
 */
export interface DerivationRule {
  /** Definitional axis: fully derived (`*`) or semiderived (`+`). */
  readonly kind: DerivationKind;
  /** Storage axis: on-request (`*`, default) or stored (`**`). */
  readonly storage?: DerivationStorage;
  /** The rule text (natural language or hand-written FORML). */
  readonly expression: string;
  /** Reserved: true once the expression is a parsed formal rule. */
  readonly isFormal?: boolean;
}

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
  /** Free-text note: informal commentary distinct from `definition`. */
  readonly note?: string;
  /**
   * Derivation rule when this fact type is derived; absent for an asserted
   * (base) fact type.
   */
  readonly derivation?: DerivationRule;
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
  private _note: string | undefined;
  private _derivation: DerivationRule | undefined;

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
    this._note = config.note;
    this._derivation = config.derivation;
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

  get note(): string | undefined {
    return this._note;
  }

  set note(value: string | undefined) {
    this._note = value;
  }

  /** The derivation rule when this fact type is derived; undefined if asserted. */
  get derivation(): DerivationRule | undefined {
    return this._derivation;
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
