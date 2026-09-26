/**
 * Phase 1b: give each entity a typed identifier.
 *
 * A reference mode is shorthand for an identifying binary between the
 * entity and a value type (`preferredIdentifyingBinary` in core). The
 * importer used to write only the shorthand, so the key column's declared
 * `data_type` had nowhere to go: the relational mapper then typed the key
 * from whichever attribute it found first, and every export reported the
 * result as the user's omission (barwise-1057). Writing the long form --
 * the identifier value type carrying the declared type, and the binary
 * whose value-side uniqueness is preferred -- needs no schema change,
 * because the mapper, the diagram and validation already read it.
 *
 * This runs after every entity exists, so an identifier can never take a
 * name an entity needs, and before ordinary value types, so a key column
 * gets its plain name ahead of a non-key column that happens to share it.
 */

import type { Constraint, ObjectType } from "@barwise/core";
import type { DbtColumn } from "../DbtSchemaTypes.js";
import {
  describeHolder,
  formatDataType,
  freeObjectTypeName,
  reportColumnType,
  resolveColumnDescription,
  resolveColumnType,
  type ResolvedColumnType,
  sameDataType,
} from "./columnTypes.js";
import type { DbtMapperContext } from "./context.js";
import { toPascalCase } from "./naming.js";

export function createIdentifierTypes(ctx: DbtMapperContext): void {
  // Which model each identifier value type was created for, so a later
  // conflict can name the model that got there first.
  const identifierOwner = new Map<string, string>();

  for (const m of ctx.doc.models) {
    const entityId = ctx.entityIdMap.get(m.name);
    const pk = ctx.pkMap.get(m.name);
    if (!entityId || !pk) continue;
    const col = m.columns.find((c) => c.name === pk.columnName);
    if (!col) continue;

    const entityName = toPascalCase(m.name);
    const resolved = resolveColumnType(ctx, col);
    reportColumnType(ctx, m.name, col, resolved);

    const identifier = claimIdentifier(ctx, m.name, entityName, col, resolved, identifierOwner);
    identifierOwner.set(identifier.id, identifierOwner.get(identifier.id) ?? m.name);

    const factName = `${entityName} has ${identifier.name}`;
    const entityRoleId = `${factName}::role1`;
    const valueRoleId = `${factName}::role2`;
    const constraints: Constraint[] = [
      { type: "internal_uniqueness", roleIds: [valueRoleId], isPreferred: true },
      { type: "internal_uniqueness", roleIds: [entityRoleId] },
      { type: "mandatory", roleId: entityRoleId },
    ];
    ctx.model.addFactType({
      name: factName,
      roles: [
        { id: entityRoleId, name: "has", playerId: entityId },
        { id: valueRoleId, name: "is of", playerId: identifier.id },
      ],
      readings: ["{0} has {1}", "{1} is of {0}"],
      constraints,
    });
  }
}

/**
 * The value type that identifies this model's entity: an existing one
 * when it already holds the column's name AND the same declared type,
 * otherwise a new one.
 *
 * Sharing by name alone would export one of two same-named keys with the
 * other's type, so a shared name with a different type -- or a name an
 * entity holds -- gets a per-entity `<Entity><Name>` identifier instead
 * (decision D1). That costs a renamed key column, which the post-mapping
 * check in `keyColumns.ts` reports; it never costs a wrong type.
 */
function claimIdentifier(
  ctx: DbtMapperContext,
  modelName: string,
  entityName: string,
  col: DbtColumn,
  resolved: ResolvedColumnType,
  identifierOwner: ReadonlyMap<string, string>,
): ObjectType {
  const candidate = toPascalCase(col.name);
  const holder = ctx.model.getObjectTypeByName(candidate);

  if (holder && holder.kind === "value" && sameDataType(holder.dataType, resolved.dataType)) {
    ctx.report.info(
      "identifier",
      modelName,
      `Key column "${col.name}" shares identifier value type "${candidate}" (${
        formatDataType(resolved.dataType)
      }) with model "${identifierOwner.get(holder.id) ?? "?"}".`,
      col.name,
    );
    return holder;
  }

  const name = holder ? freeObjectTypeName(ctx, `${entityName}${candidate}`) : candidate;
  if (holder) {
    const owner = identifierOwner.get(holder.id);
    ctx.report.warning(
      "identifier",
      modelName,
      `Key column "${col.name}" (${
        formatDataType(resolved.dataType)
      }) cannot share the name "${candidate}": `
        + `${describeHolder(holder)}${
          owner ? ` identifies model "${owner}"` : ""
        } already holds it. `
        + `Created identifier value type "${name}" instead.`,
      col.name,
    );
  }

  return ctx.model.addObjectType({
    name,
    kind: "value",
    definition: resolveColumnDescription(ctx, modelName, col),
    ...(resolved.dataType ? { dataType: resolved.dataType } : {}),
  });
}
