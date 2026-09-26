/**
 * Final phase: say when an imported key will export under another name.
 *
 * The relational mapper names a key column from the value type that
 * identifies the entity, not from the dbt column the key came from. Two
 * things make those differ: a per-entity identifier created because a
 * shared name was taken (`OrdersId`, exported as `orders_id` rather than
 * `id`), and a column name that does not survive the PascalCase/snake_case
 * round trip (`customerID` exports as `customer_id`).
 *
 * Both are answered by running the mapper itself over the imported model
 * rather than by predicting its naming rule here: a copy of that rule
 * would have to agree with `RelationalMapper` and nothing would check it.
 */

import { RelationalMapper } from "@barwise/core/mapping";
import type { DbtMapperContext } from "./context.js";

export function reportKeyColumnRenames(ctx: DbtMapperContext): void {
  const schema = new RelationalMapper().map(ctx.model);
  const tableByEntity = new Map(schema.tables.map((t) => [t.sourceElementId, t]));

  for (const m of ctx.doc.models) {
    const entityId = ctx.entityIdMap.get(m.name);
    const pk = ctx.pkMap.get(m.name);
    if (!entityId || !pk) continue;
    const exported = tableByEntity.get(entityId)?.primaryKey.columnNames;
    if (!exported || exported.length !== 1) continue;
    const exportedName = exported[0]!;
    if (exportedName === pk.columnName) continue;
    ctx.report.warning(
      "identifier",
      m.name,
      `Key column "${pk.columnName}" will export as "${exportedName}".`,
      pk.columnName,
    );
  }
}
