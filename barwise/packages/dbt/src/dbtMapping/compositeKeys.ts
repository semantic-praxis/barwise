/**
 * Phase 1a and 2b: a model keyed by a model-level
 * `dbt_utils.unique_combination_of_columns` reads as the fact type it
 * states (composite-key-tables.spec.md), the rule the DDL importer applies
 * to a table keyed on several columns. The two packages keep their own
 * code; `cli/tests/compositeKeyParity.test.ts` fails when they disagree.
 *
 * Such a model used to import as nothing at all: a key was found only in
 * a single column with both `unique` and `not_null`, so the model was
 * skipped and named on stderr (barwise-nkn, three trial imports).
 */

import { type Constraint, generateId } from "@barwise/core";
import type { DbtModel } from "../DbtSchemaTypes.js";
import { claimValueType, resolveColumnType } from "./columnTypes.js";
import { hasTest } from "./constraints.js";
import type { CompositeInfo, DbtMapperContext } from "./context.js";
import { toPascalCase } from "./naming.js";

/** The model-level dbt test whose columns name a composite key. */
export const KEY_TEST = "dbt_utils.unique_combination_of_columns";

/**
 * The columns a model-level combination test names, when it names two or
 * more and each is `not_null`: the test proves the combination unique but
 * not present, and a key with a null in it identifies nothing (PR #620
 * review). A SQL primary key and the single-column rule both demand it.
 */
export function compositeKeyOf(m: DbtModel): string[] | undefined {
  for (const test of m.modelTests) {
    if (test.type !== "custom" || test.name !== KEY_TEST) continue;
    const cols = test.config["combination_of_columns"];
    if (!Array.isArray(cols) || cols.length < 2) continue;
    const names = cols.map(String);
    const columns = names.map((n) => m.columns.find((c) => c.name === n));
    if (columns.every((c) => c !== undefined && hasTest(c, "not_null"))) return names;
  }
  return undefined;
}

/**
 * Phase 1a: decide each composite-key model's reading. A `relationships`
 * column is a foreign key; dbt states one per column, so each is a role.
 * The roles are the key's columns plus, when exactly one other column
 * remains that is `not_null` and not `unique` by itself, that column. The
 * fact type is objectified when other columns remain, when another model
 * references this one, or when it would be a binary over one reference and
 * one value, which the relational mapper writes into the entity's table.
 */
export function analyzeComposites(ctx: DbtMapperContext): void {
  const referenced = new Set(
    [...ctx.relMap.values()].flatMap((rels) => rels.map((r) => r.targetModelName)),
  );
  for (const m of ctx.doc.models) {
    if (ctx.pkMap.has(m.name)) continue;
    const key = compositeKeyOf(m);
    if (!key) continue;
    const relCols = new Set((ctx.relMap.get(m.name) ?? []).map((r) => r.columnName));
    if (!key.some((c) => relCols.has(c))) continue;
    const others = m.columns.filter((c) => !key.includes(c.name));
    const candidates = others.filter((c) => !hasTest(c, "unique"));
    const lone = candidates.length === 1 ? candidates[0]! : undefined;
    const extra = lone && hasTest(lone, "not_null") ? lone.name : undefined;
    const roles = (extra ? [...key, extra] : key).map((c) => [c]);
    const valueBinary = roles.length === 2 && roles.filter((r) => relCols.has(r[0]!)).length === 1;
    const remaining = others.length - (extra ? 1 : 0);
    const info: CompositeInfo = {
      roles,
      key,
      objectified: referenced.has(m.name) || remaining > 0 || valueBinary,
    };
    ctx.compositeMap.set(m.name, info);
    ctx.report.info(
      "identifier",
      m.name,
      `Composite key (${key.join(", ")}) from ${KEY_TEST}: imported as ${
        info.objectified ? "an objectified" : "a"
      } fact type over ${roles.map((r) => r[0]).join(", ")}.`,
    );
  }
}

/** The columns of a model that a composite reading made roles, so the attribute phases skip them. */
export function compositeRoleColumns(ctx: DbtMapperContext, modelName: string): Set<string> {
  return new Set((ctx.compositeMap.get(modelName)?.roles ?? []).flat());
}

/** Phase 2b: build each composite-key model's fact type, objectified where its reading says so. */
export function createCompositeFactTypes(ctx: DbtMapperContext): void {
  for (const m of ctx.doc.models) {
    const info = ctx.compositeMap.get(m.name);
    if (!info) continue;
    const entityId = ctx.entityIdMap.get(m.name);
    const entityName = toPascalCase(m.name);
    const rels = ctx.relMap.get(m.name) ?? [];
    const roles: { id: string; name: string; playerId: string; }[] = [];
    for (const [colName] of info.roles) {
      const col = m.columns.find((c) => c.name === colName)!;
      const rel = rels.find((r) => r.columnName === colName);
      let playerId: string | undefined;
      if (rel) {
        playerId = ctx.entityIdMap.get(rel.targetModelName);
        if (!playerId) {
          ctx.report.gap(
            "relationship",
            m.name,
            `Composite key column "${colName}" references model "${rel.targetModelName}", which has no identifiable key -- the model's fact type is skipped.`,
            colName,
          );
          break;
        }
      } else {
        const resolved = resolveColumnType(ctx, col);
        const claim = claimValueType(ctx, entityName, entityId ?? "", col, resolved, "attribute");
        playerId = claim.kind === "share"
          ? claim.valueType.id
          : ctx.model.addObjectType({
            name: claim.name,
            kind: "value",
            ...(resolved.dataType ? { dataType: resolved.dataType } : {}),
          }).id;
      }
      roles.push({ id: generateId(), name: "is in", playerId });
    }
    if (roles.length !== info.roles.length) continue;

    const players = roles.map((r) => ctx.model.getObjectType(r.playerId)?.name ?? "?");
    const words = m.name.replace(/_/g, " ").toLowerCase();
    const list = (items: string[]) =>
      items.length === 2
        ? items.join(" and ")
        : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
    const keyRoleIds = info.roles.flatMap((
      [c],
      i,
    ) => (info.key.includes(c!) ? [roles[i]!.id] : []));
    const constraints: Constraint[] = [{ type: "internal_uniqueness", roleIds: keyRoleIds }];
    const factType = ctx.model.addFactType({
      name: `${list(players)} ${words}`,
      roles,
      readings: [`${list(roles.map((_, i) => `{${i}}`))} have ${words}`],
      constraints,
    });
    if (info.objectified && entityId) {
      ctx.model.addObjectifiedFactType({ factTypeId: factType.id, objectTypeId: entityId });
    }
  }
}
