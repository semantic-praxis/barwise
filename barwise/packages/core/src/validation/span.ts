import { type Constraint, roleIdsOf } from "../model/Constraint.js";
import type { FactType } from "../model/FactType.js";
import type { OrmModel } from "../model/OrmModel.js";

/**
 * How a diagnostic names and locates a constraint across fact types
 * (orm-format-3, Open decision 9, option (a)). Such a constraint has no
 * host: the fact type a 2.0 file nests it under is an accident of the
 * file, so a diagnostic that named it, or pointed the editor at it, would
 * change when the file was reordered. The constraint is located by its
 * own id and named by the fact types it spans.
 */

/**
 * The fact types a constraint spans, as a phrase for a message:
 * `fact type "A"`, `fact types "A" and "B"`, `fact types "A", "B" and "C"`,
 * in model order. A constraint none of whose roles resolves spans
 * nothing, and the dangling roles are reported separately.
 */
export function constraintSpan(model: OrmModel, c: Constraint): string {
  return spanPhrase(model.factTypesHolding(roleIdsOf(c)).map((ft) => ft.name));
}

/** The phrase for a list of fact type names; see `constraintSpan`. */
export function spanPhrase(names: readonly string[]): string {
  const quoted = names.map((n) => `"${n}"`);
  if (quoted.length === 0) return "no fact type in the model";
  if (quoted.length === 1) return `fact type ${quoted[0]}`;
  return `fact types ${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

/**
 * A constraint's id as a diagnostic's element id. Every constraint in a
 * model has one -- loading derives it, construction fills it
 * (barwise-nkq) -- so a missing id is a caller that built a constraint
 * around both, and a diagnostic pointing at the empty string would hide
 * that. The optional type goes in WS3c.
 */
export function constraintElementId(c: Constraint): string {
  if (c.id === undefined) {
    throw new Error(`A ${c.type} constraint reached validation without an id.`);
  }
  return c.id;
}

/**
 * The one fact type holding every one of a constraint's roles, if there is
 * one -- whichever fact type a 2.0 file nested it under. An external
 * uniqueness for which this answers is "all local": an internal uniqueness
 * would say the same thing. A dangling role makes the answer undefined, as
 * a role of another fact type does.
 */
export function localFactTypeOf(model: OrmModel, c: Constraint): FactType | undefined {
  return localFactType(model, roleIdsOf(c));
}

function localFactType(
  model: OrmModel,
  roleIds: readonly string[],
): FactType | undefined {
  const held = model.factTypesHolding(roleIds);
  const [only] = held;
  return held.length === 1 && roleIds.every((rid) => only!.hasRole(rid)) ? only : undefined;
}
