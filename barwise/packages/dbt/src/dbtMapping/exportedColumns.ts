/**
 * Final phase: say when an imported column will export under another name.
 *
 * The relational mapper names a column from the value type the column
 * became, not from the dbt column it came from. They differ when a value
 * type had to take a per-entity name because a shared one was taken
 * (`OrdersId`, exported as `orders_id` rather than `id`; decision D1 and
 * `claimValueType`), and when a column name does not survive the
 * PascalCase/snake_case round trip (`customerID` exports as
 * `customer_id`).
 *
 * Both are answered by running the mapper itself over the imported model
 * rather than by predicting its naming rule here: a copy of that rule
 * would have to agree with `RelationalMapper` and nothing would check it.
 * The mapper records on each column the entity-side role it came from,
 * and the importer records the same role per dbt column
 * (`columnRoleIdMap`), so the two meet on the role id.
 */

import { RelationalMapper } from "@barwise/core/mapping";
import type { DbtMapperContext } from "./context.js";

export function reportColumnRenames(ctx: DbtMapperContext): void {
  const schema = new RelationalMapper().map(ctx.model);
  const exportedNameByRole = new Map<string, string>();
  for (const table of schema.tables) {
    for (const column of table.columns) {
      if (column.sourceRoleId) exportedNameByRole.set(column.sourceRoleId, column.name);
    }
  }

  for (const m of ctx.doc.models) {
    const pk = ctx.pkMap.get(m.name);
    for (const col of m.columns) {
      const roleId = ctx.columnRoleIdMap.get(`${m.name}::${col.name}`);
      const exportedName = roleId ? exportedNameByRole.get(roleId) : undefined;
      if (!exportedName || exportedName === col.name) continue;
      ctx.report.warning(
        col.name === pk?.columnName ? "identifier" : "data_type",
        m.name,
        `${
          col.name === pk?.columnName ? "Key column" : "Column"
        } "${col.name}" will export as "${exportedName}".`,
        col.name,
      );
    }
  }
}
