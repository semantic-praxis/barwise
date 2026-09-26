/**
 * Which value type an imported column plays: one it may share, or a new
 * one under a free name. The dbt and DDL importers both ask this, and
 * the answer must not depend on the path a schema came in by, so the
 * rule lives here once (ddl-import-fidelity.spec.md, moved from the dbt
 * importer's `claimValueType`). Naming the candidate and wording the
 * report stay with each importer; only the decision is shared.
 *
 * A same-named object type is shared only when sharing loses nothing:
 *
 * - it is a value type, never an entity (an entity would turn the column
 *   into a reference);
 * - this entity does not already play it, since a second fact type
 *   "<Entity> has <Name>" would collide with the first and
 *   `OrmModel.addFactType` throws;
 * - a key shares only an identical declared type (a missing type is not
 *   a match), and an ordinary column shares unless it declares a type
 *   the holder does not have -- otherwise the column would export as the
 *   holder's type. An ordinary column with no type of its own shares.
 * - the value constraints are the same set of values and ranges, or both
 *   absent. A value type's constraint is part of what it means: sharing
 *   `Status` enum [active] with a property declaring enum [pending]
 *   would constrain the second to the first's domain, and sharing it with
 *   a property declaring no enum would impose one it never had.
 *
 * Anything else gets `<Entity><Name>`, and the caller reports it.
 */
import {
  type DataTypeDef,
  dataTypeOf,
  type ObjectType,
  type ValueConstraintDef,
  valueConstraintOf,
} from "../model/ObjectType.js";
import type { OrmModel } from "../model/OrmModel.js";

export type ValueTypeClaim =
  | { readonly kind: "share"; readonly valueType: ObjectType; }
  | { readonly kind: "create"; readonly name: string; readonly displaced?: ObjectType; };

export function claimValueTypeName(
  model: OrmModel,
  entityId: string,
  entityName: string,
  candidate: string,
  dataType: DataTypeDef | undefined,
  role: "key" | "attribute",
  valueConstraint?: ValueConstraintDef,
): ValueTypeClaim {
  const holder = model.getObjectTypeByName(candidate);
  if (!holder) return { kind: "create", name: candidate };

  const alreadyPlayed = model
    .factTypesForObjectType(holder.id)
    .some((ft) => ft.roles.some((r) => r.playerId === entityId));
  const typesAgree = role === "key"
    ? sameDataType(dataTypeOf(holder), dataType)
    : dataType === undefined || sameDataType(dataTypeOf(holder), dataType);

  const constraintsAgree = sameValueConstraint(valueConstraintOf(holder), valueConstraint);

  if (holder.kind === "value" && !alreadyPlayed && typesAgree && constraintsAgree) {
    return { kind: "share", valueType: holder };
  }
  return {
    kind: "create",
    name: freeObjectTypeName(model, `${entityName}${candidate}`),
    displaced: holder,
  };
}

/** Whether two data types are the same type: name, length and scale. */
function sameDataType(a: DataTypeDef | undefined, b: DataTypeDef | undefined): boolean {
  if (!a || !b) return false;
  return a.name === b.name && a.length === b.length && a.scale === b.scale;
}

/** Whether two value constraints admit the same values; order does not matter. */
function sameValueConstraint(
  a: ValueConstraintDef | undefined,
  b: ValueConstraintDef | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  const key = (c: ValueConstraintDef) =>
    JSON.stringify([
      [...c.values].sort(),
      (c.ranges ?? []).map((r) => JSON.stringify(r)).sort(),
    ]);
  return key(a) === key(b);
}

/**
 * The first name, starting from `preferred`, that no object type holds.
 * `OrmModel.addObjectType` refuses a duplicate name by throwing, so every
 * fallback name is checked rather than assumed free.
 */
function freeObjectTypeName(model: OrmModel, preferred: string): string {
  if (!model.getObjectTypeByName(preferred)) return preferred;
  for (let i = 2;; i += 1) {
    const name = `${preferred}${i}`;
    if (!model.getObjectTypeByName(name)) return name;
  }
}
