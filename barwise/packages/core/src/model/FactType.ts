import type { Complete } from "../util/complete.js";
import {
  type Constraint,
  type InternalConstraint,
  type InternalUniquenessConstraint,
  isExternalConstraint,
  isInternalConstraint,
} from "./Constraint.js";
import type { ConstraintAdmission } from "./constraintAdmission.js";
import { withId } from "./id.js";
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
 * verbalized, never parsed or executed by core (ADR `metamodel-evolution-policy` filter 3). The
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
  /**
   * The fact type's own constraints. One across fact types lives in the
   * model: add it with `OrmModel.addConstraint` (orm-format-3 WS3c).
   */
  readonly constraints?: readonly InternalConstraint[];
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
  private readonly _constraints: InternalConstraint[];
  private _admission: ConstraintAdmission | undefined;
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
    this._constraints = [];
    for (const c of config.constraints ?? []) this.addConstraint(c);
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

  /**
   * The constraints that live in this fact type: the internal kinds, whose
   * roles are all its own. One across fact types lives in the model
   * (`OrmModel.constraints`), whichever fact type a 2.0 file nests it
   * under (orm-format-3 WS3c).
   */
  get internalConstraints(): readonly InternalConstraint[] {
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

  /**
   * The model that holds this fact type, as the narrow interface it admits
   * constraints through; none until a model adds it. Called by
   * `OrmModel.addFactType` once the fact type is stored, before its own
   * constraints are added, so each is admitted and named; with an admission only the model holds, so no other caller can reach
   * the model's id index through a fact type.
   */
  joinModel(admission: ConstraintAdmission): void {
    if (this._admission !== undefined) {
      throw new Error(`Fact type "${this.name}" is already in a model.`);
    }
    this._admission = admission;
  }

  /**
   * The model removed this fact type, so a constraint added to it from
   * now on is the fact type's alone and enters no model's index.
   */
  leaveModel(admission: ConstraintAdmission): void {
    if (this._admission === admission) this._admission = undefined;
  }

  /** Find a role by its id. Returns undefined if not found. */
  getRoleById(roleId: string): Role | undefined {
    return this._roles.find((r) => r.id === roleId);
  }

  /** Check whether a role id belongs to this fact type. */
  hasRole(roleId: string): boolean {
    return this._roles.some((r) => r.id === roleId);
  }

  /**
   * The uniqueness constraint spanning exactly these roles, in any order:
   * how a caller that added one without an id finds it again, to name it as
   * a preferred identifier, without depending on the order it was listed in.
   */
  uniquenessOver(roleIds: readonly string[]): InternalUniquenessConstraint | undefined {
    const want = [...roleIds].sort().join("\u0000");
    return this._constraints.find((c): c is InternalUniquenessConstraint =>
      c.type === "internal_uniqueness" && [...c.roleIds].sort().join("\u0000") === want
    );
  }

  /**
   * Add a constraint to this fact type, giving it an id when it has none:
   * in a model, its minted name (iri-identity, decision 17); standalone, one
   * from the installed generator, as the constructor does (barwise-nkq).
   * Without one, every
   * output that names a constraint by id would have nothing to name it by
   * until the model was saved and reloaded.
   *
   * A constraint across fact types lives in the model
   * (`OrmModel.addConstraint`). The type says so; the check is for a
   * value whose type was asserted, such as a parsed file, which would
   * otherwise be stored where no reader of the model's constraints looks.
   *
   * Returns the constraint as stored, which is a copy carrying its id, as
   * `OrmModel.addConstraint` does: a caller that needs the id right away
   * -- a preferred identifier set just after the add -- reads it here
   * (iri-identity 6a; in 6b the id may be minted rather than generated).
   * In a model that refuses ids across kinds (a 4.0 model), one whose
   * sentence cannot be minted comes back with no id (decision 19).
   */
  addConstraint(constraint: InternalConstraint): InternalConstraint {
    const c = checkInternalConstraint(constraint, this.name);
    // In a model, the model names it and enters its id in the model's
    // index; standalone, the fact type gives it an id itself.
    const stored = this._admission?.admitConstraint(c, this.id) ?? withId(c);
    this._constraints.push(stored);
    return stored;
  }

  /** Get all role ids that reference a given object type (by player id). */
  rolesForPlayer(playerId: string): readonly Role[] {
    return this._roles.filter((r) => r.playerId === playerId);
  }
}

/**
 * Refuse what a fact type cannot hold: a constraint across fact types,
 * which lives in the model, or a kind that is no constraint. The check is
 * for a value whose type was asserted, such as a parsed file. Exported so
 * `OrmModel.addFactType` refuses a config before storing anything.
 */
export function checkInternalConstraint(
  constraint: InternalConstraint,
  factTypeName: string,
): InternalConstraint {
  const c = constraint as Constraint;
  if (isExternalConstraint(c)) {
    throw new Error(
      `A ${c.type} constraint spans fact types, so it lives in the model, `
        + `not in fact type "${factTypeName}": add it with OrmModel.addConstraint.`,
    );
  }
  if (!isInternalConstraint(c)) {
    throw new Error(
      `Fact type "${factTypeName}" has no constraint kind "${
        String((constraint as { type?: unknown; }).type)
      }".`,
    );
  }
  return c;
}

/**
 * Project a FactType back to the config shape that constructed it,
 * listing every field once. Callers that rebuild a fact type (the merge
 * today; WS8's builder-based split once it exists) spread this and
 * override only what they mean to change, so a field added to
 * `FactTypeConfig` cannot be dropped by a hand-copied literal elsewhere
 * (barwise-927). Both literals are typed `Complete<...>` so they cannot
 * drop a field either: the next config field, on the fact type or on
 * the role, is a compile error here until it is listed. WS1's sealed
 * records make this redundant -- a spread of the record itself will do
 * the same job.
 */
export function toFactTypeConfig(ft: FactType): FactTypeConfig {
  const config: Complete<FactTypeConfig> = {
    name: ft.name,
    id: ft.id,
    roles: ft.roles.map((r) => {
      const role: Complete<RoleConfig> = { name: r.name, id: r.id, playerId: r.playerId };
      return role;
    }),
    readings: ft.readings.map((r) => r.template),
    constraints: ft.internalConstraints,
    definition: ft.definition,
    note: ft.note,
    derivation: ft.derivation,
  };
  return config;
}
