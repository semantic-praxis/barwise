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

import { resolvePreferredIdentifier } from "@barwise/core";
import { DBT_KEY_TEST } from "@barwise/core/mapping";
import type { DbtModel, DbtTest } from "../DbtSchemaTypes.js";
import {
  claimValueType,
  reportColumnType,
  resolveColumnDescription,
  resolveColumnType,
} from "./columnTypes.js";
import { findRelationshipTest, hasTest } from "./constraints.js";
import {
  type CompositeInfo,
  type DbtMapperContext,
  referenceName,
  type RelationshipInfo,
} from "./context.js";
import { toPascalCase } from "./naming.js";

/** The columns a model-level combination test names, or undefined for any other test. */
export function combinationOf(test: DbtModel["modelTests"][number]): string[] | undefined {
  if (test.type !== "custom" || test.name !== DBT_KEY_TEST) return undefined;
  const cols = test.config["combination_of_columns"];
  return Array.isArray(cols) ? cols.map(String) : undefined;
}

/**
 * Whether two column lists name the same columns, in any order.
 */
export function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((c) => b.includes(c));
}

/**
 * Whether a combination test's columns are exactly one multi-column
 * foreign key's: that reference's one-to-one, the far-side uniqueness the
 * DDL importer reads from a UNIQUE over a foreign key's columns, and not a
 * key of the model (composite-foreign-key-round-trip.spec.md). Read as a
 * key, it would be a second candidate beside the model's own, and the
 * model would lose its identifier.
 */
export function isReferenceUniqueness(m: DbtModel, names: readonly string[]): boolean {
  return m.foreignKeys.some((fk) => sameColumns(fk.columns, names));
}

/**
 * Every combination a model-level combination test names that this rule
 * reads as a key (composite-key-tables.spec.md, requirement 5): two or
 * more columns, each `not_null`, at least one a reference column (a
 * `relationships` test, or a multi-column foreign key), and not exactly one
 * foreign key's columns (isReferenceUniqueness).
 * The test proves the combination unique but not present, and a key with
 * a null in it identifies nothing (PR #620 review); a key of values alone
 * is not this rule's. One predicate, so the analysis that suppresses the
 * "no identifier" gap and the mapping that builds the fact type cannot
 * disagree about a model (PR #621 review).
 */
export function candidateKeysOf(m: DbtModel): string[][] {
  const keys: string[][] = [];
  for (const test of m.modelTests) {
    const names = combinationOf(test);
    // Repeated names are one column, not a combination (PR #621 review).
    if (!names || names.length < 2 || new Set(names).size !== names.length) continue;
    const columns = names.map((n) => m.columns.find((c) => c.name === n));
    if (!columns.every((c) => c !== undefined && hasTest(c, "not_null"))) continue;
    const inForeignKey = (c: string) => m.foreignKeys.some((fk) => fk.columns.includes(c));
    if (!columns.some((c) => findRelationshipTest(c!) !== undefined || inForeignKey(c!.name))) {
      continue;
    }
    if (isReferenceUniqueness(m, names)) continue;
    // The same columns in another order are the same key stated twice, not
    // a second candidate (PR #621 review).
    const set = [...names].sort().join("\0");
    if (keys.some((k) => [...k].sort().join("\0") === set)) continue;
    keys.push(names);
  }
  return keys;
}

/**
 * The model's composite key, when exactly one combination qualifies. Two
 * are two candidate keys with nothing marking one preferred, which a DDL
 * table, having one PRIMARY KEY, can never state; the model keeps today's
 * reading and `analyzeModels` names them (composite-key-tables.spec.md,
 * requirement 5).
 */
export function compositeKeyOf(m: DbtModel): string[] | undefined {
  const keys = candidateKeysOf(m);
  // A declared primary key is the key whatever else qualifies, so every
  // phase that asks reads the same one; one that is not a candidate is no
  // composite key (dbt-alternate-uniqueness.spec.md).
  const declared = declaredKeyOf(m);
  if (declared) return declared.length > 1 ? keys.find((k) => sameColumns(k, declared)) : undefined;
  return keys.length === 1 ? keys[0] : undefined;
}

/**
 * Whether a combination test holds over every row SQL UNIQUE constrains:
 * it has no `where` filter, or only the one the export writes over nullable
 * columns, `<each column> is not null`, which skips the rows SQL UNIQUE
 * skips (dbt-alternate-uniqueness.spec.md). Any other filter makes it a
 * uniqueness over some rows only, which is no ORM uniqueness.
 */
export function holdsForEveryRow(test: DbtModel["modelTests"][number]): boolean {
  if (test.type !== "custom") return true;
  const where = (test.config["config"] as { where?: unknown; } | undefined)?.where;
  if (where === undefined) return true;
  const names = combinationOf(test) ?? [];
  return where === names.map((c) => `${c} is not null`).join(" and ");
}

/**
 * The model's `primary_key` constraint's columns, when every one is a
 * column of the model; a constraint naming another is set aside, and the
 * key is found from the tests as without one.
 */
export function declaredKeyOf(m: DbtModel): readonly string[] | undefined {
  const declared = m.primaryKey;
  return declared && declared.every((n) => m.columns.some((c) => c.name === n))
    ? declared
    : undefined;
}

/**
 * Phase 1a: decide each composite-key model's reading. Each reference in
 * the key is one role, a multi-column foreign key's columns together,
 * placed at its first key column, as the DDL importer's
 * `compositeReading` places them; each other key column is a role. The
 * shapes that reading declines are declined here too: a reference only
 * partly in the key, two references sharing a key column, a key that is
 * one reference. The roles are the key's plus, when exactly one other
 * unit remains (a column, or all the columns of one multi-column foreign
 * key) that is `not_null` and not `unique` by itself, and no other model
 * references this one, that unit. The
 * fact type is objectified when other columns remain, when another model
 * references this one, or when it would be a binary over one reference and
 * one value, which the relational mapper writes into the entity's table.
 */
export function analyzeComposites(ctx: DbtMapperContext): void {
  const referenced = new Set(
    [...ctx.relMap.values()].flatMap((rels) => rels.map((r) => r.targetModelName)),
  );
  const pending = new Map<string, {
    m: DbtModel;
    key: string[];
    roles: string[][];
    objectified: boolean;
  }>();
  for (const m of ctx.doc.models) {
    if (ctx.pkMap.has(m.name)) continue;
    const key = compositeKeyOf(m);
    if (!key) continue;
    const rels = ctx.relMap.get(m.name) ?? [];
    const relOf = (c: string) => rels.filter((r) => r.columns.includes(c));
    if (!key.some((c) => relOf(c).length > 0)) {
      // Its only reference column was in a foreign key analyzeModels set
      // aside, so nothing in it is a reference read here.
      ctx.report.gap(
        "identifier",
        m.name,
        `Composite key (${
          key.join(", ")
        }): none of its columns is a reference read here, so the model is skipped.`,
      );
      continue;
    }
    // analyzeModels set aside every reference keyRolesOf would decline, so
    // what is left always reads; the fallback is the one-column-per-role
    // reading those models had before.
    const keyRoles = keyRolesOf(key, rels) ?? key.map((c) => [c]);
    const others = m.columns.filter((c) => !key.includes(c.name));
    const candidates = others.filter((c) => !hasTest(c, "unique"));
    // The units an extra role could be: a column, or the columns of the one
    // multi-column foreign key it is in (composite-foreign-key-round-trip.spec.md).
    const unitOf = (c: string): string | undefined => {
      const multi = relOf(c).filter((r) => r.columns.length > 1);
      return multi.length === 0 ? c : multi.length === 1 ? multi[0]!.columns.join("\0") : undefined;
    };
    const units = new Set(candidates.map((c) => unitOf(c.name)));
    const lone = units.size === 1 && !units.has(undefined)
      ? [...units][0]!.split("\0").map((n) => candidates.find((c) => c.name === n))
      : undefined;
    // A referenced model must be objectified, and a fact type unique over
    // only some of its roles is not one to objectify (PR #620 review). A
    // foreign key is the extra role only whole, each column a candidate.
    const extra = !referenced.has(m.name) && lone
        && lone.every((c) => c !== undefined && hasTest(c, "not_null"))
      ? lone.map((c) => c!.name)
      : undefined;
    const roles = extra ? [...keyRoles, extra] : keyRoles;
    const valueBinary = roles.length === 2
      && roles.filter((r) => relOf(r[0]!).length > 0).length === 1;
    const remaining = others.length - (extra?.length ?? 0);
    pending.set(m.name, {
      m,
      key,
      roles,
      objectified: referenced.has(m.name) || remaining > 0 || valueBinary,
    });
  }

  // Every reference among a model's roles must reach a model with a key:
  // a single column, or a composite that is itself admitted. Otherwise the
  // fact type cannot be built, and admitting the model would create its
  // objectifier anyway: an entity with an invented key and nothing to
  // objectify (PR #621 review). Settled to a fixed point, since dropping
  // one composite can strand another that references it.
  const unreachable = (name: string) => {
    const { roles } = pending.get(name)!;
    const rels = ctx.relMap.get(name) ?? [];
    return roles.map((cols) => rels.find((r) => sameColumns(r.columns, cols))).find((rel) =>
      rel !== undefined && !ctx.pkMap.has(rel.targetModelName) && !pending.has(rel.targetModelName)
    );
  };
  // A composite whose roles reach back to itself, directly or through
  // other composites, would be identified through its own objectifier:
  // core rejects that model as an identification cycle (PR #621 review).
  // Every member of such a cycle is reported and skipped first; the fixed
  // point below then drops whatever depended on them.
  const targets = (name: string) => {
    const { roles } = pending.get(name)!;
    const rels = ctx.relMap.get(name) ?? [];
    return roles.flatMap((cols) => {
      const rel = rels.find((r) => sameColumns(r.columns, cols));
      return rel && pending.has(rel.targetModelName) ? [rel.targetModelName] : [];
    });
  };
  const reachesItself = (start: string) => {
    const seen = new Set<string>();
    const stack = targets(start);
    while (stack.length > 0) {
      const next = stack.pop()!;
      if (next === start) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...targets(next));
    }
    return false;
  };
  const cyclic = [...pending.keys()].filter(reachesItself);
  for (const name of cyclic) {
    const { key } = pending.get(name)!;
    ctx.report.gap(
      "identifier",
      name,
      `Composite key (${
        key.join(", ")
      }): its roles reference this model again, directly or through other composite keys, so it would be identified through itself; the model is skipped.`,
    );
  }
  for (const name of cyclic) pending.delete(name);

  for (let changed = true; changed;) {
    changed = false;
    for (const name of [...pending.keys()]) {
      const rel = unreachable(name);
      if (!rel) continue;
      const { key } = pending.get(name)!;
      pending.delete(name);
      changed = true;
      ctx.report.gap(
        "identifier",
        name,
        `Composite key (${key.join(", ")}): column "${
          referenceName(rel)
        }" references model "${rel.targetModelName}", which has no identifiable key, so the fact type cannot be built and the model is skipped.`,
        rel.columns[0],
      );
    }
  }

  for (const { m, key, roles, objectified } of pending.values()) {
    const info: CompositeInfo = { roles, key, objectified };
    ctx.compositeMap.set(m.name, info);
    ctx.report.info(
      "identifier",
      m.name,
      `Composite key (${key.join(", ")}) from ${DBT_KEY_TEST}: imported as ${
        info.objectified ? "an objectified" : "a"
      } fact type over ${roles.map((r) => r.length > 1 ? `(${r.join(", ")})` : r[0]).join(", ")}.`,
    );
  }
}

/**
 * A key's roles, in key order: each reference wholly inside it at its
 * first key column, each other column alone. Undefined for the shapes the
 * DDL importer's `compositeReading` declines (PR #620 and #621 review): a
 * reference partly inside the key, two references sharing a key column,
 * or a key that is one reference.
 */
export function keyRolesOf(
  key: readonly string[],
  rels: readonly RelationshipInfo[],
): string[][] | undefined {
  const inKey = (c: string) => key.includes(c);
  if (rels.some((r) => r.columns.some(inKey) && !r.columns.every(inKey))) return undefined;
  const keyRels = rels.filter((r) => r.columns.every(inKey));
  const covered = keyRels.flatMap((r) => r.columns);
  if (new Set(covered).size !== covered.length) return undefined;
  const roles: string[][] = [];
  for (const c of key) {
    const rel = keyRels.find((r) => r.columns.includes(c));
    if (!rel) roles.push([c]);
    else if (key.find((k) => rel.columns.includes(k)) === c) roles.push([...rel.columns]);
  }
  return roles.length < 2 ? undefined : roles;
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
    const roles: { name: string; playerId: string; }[] = [];
    // Each role's columns, by the role's position: the model names the
    // roles when the fact type is added, so what refers to one waits for it.
    const roleColumns: (readonly string[])[] = [];
    // An accepted_values test on a value role is its value constraint, as
    // buildConstraints reads it on any other column (PR #621 review).
    const valueConstraints: { readonly role: number; readonly values: string[]; }[] = [];
    for (const cols of info.roles) {
      const colName = cols[0]!;
      const col = m.columns.find((c) => c.name === colName)!;
      // The reference this role is, by its columns: its first column may
      // carry a single-column reference of its own as well.
      const rel = rels.find((r) => sameColumns(r.columns, cols));
      let playerId: string | undefined;
      if (rel) {
        playerId = ctx.entityIdMap.get(rel.targetModelName);
        if (!playerId) {
          ctx.report.gap(
            "relationship",
            m.name,
            `Composite key column "${
              cols.join(", ")
            }" references model "${rel.targetModelName}", which has no identifiable key -- the model's fact type is skipped.`,
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
            // Described as the ordinary value-column path describes it
            // (valueTypes.ts; PR #621 review).
            definition: resolveColumnDescription(ctx, m.name, col),
            ...(resolved.dataType ? { dataType: resolved.dataType } : {}),
          }).id;
        if (claim.kind !== "share") reportColumnType(ctx, m.name, col, resolved);
      }
      const role = roles.length;
      roles.push({ name: "is in", playerId });
      roleColumns.push(cols);
      const accepted = rel
        ? undefined
        : col.tests.find((t): t is Extract<DbtTest, { type: "accepted_values"; }> =>
          t.type === "accepted_values"
        );
      if (accepted && accepted.values.length > 0) {
        valueConstraints.push({ role, values: accepted.values as string[] });
      } else if (accepted) {
        ctx.report.warning(
          "constraint",
          m.name,
          `accepted_values test on column "${colName}" has an empty values list -- no value constraint generated. Check the dbt schema YAML.`,
          colName,
        );
      }
    }
    if (roles.length !== info.roles.length) continue;

    const players = roles.map((r) => ctx.model.getObjectType(r.playerId)?.name ?? "?");
    const words = m.name.replace(/_/g, " ").toLowerCase();
    const list = (items: string[]) =>
      items.length === 2
        ? items.join(" and ")
        : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
    // Every role is "is in", so the ids take the suffix rule
    // (`<ft>.is_in`, `<ft>.is_in_2`), as an import may (iri-identity,
    // decision 5 as amended).
    const factType = ctx.model.addFactType({
      name: `${list(players)} ${words}`,
      roles,
      readings: [`${list(roles.map((_, i) => `{${i}}`))} have ${words}`],
      // Unobjectified, the fact type is all that stands for the model, so
      // it carries an explicit description; objectified, the entity does
      // (PR #621 review). An inferred one is not invented for it.
      ...(!info.objectified && m.description ? { definition: m.description } : {}),
    }, { suffixRepeatedRoleNames: true });
    const roleIds = factType.roles.map((r) => r.id);
    for (const [i, cols] of roleColumns.entries()) {
      // So reportColumnRenames can match the column to the mapper output, as
      // it does for identifier and ordinary columns (PR #621 review).
      // Every column of a multi-column role records it, as the mapper
      // writes it on each of the columns it makes for the role.
      for (const c of cols) {
        ctx.columnRoleIdMap.set(`${m.name}::${c}`, roleIds[i]!);
        // A role of the relationship stands for itself in a uniqueness over
        // the model's columns, as DDL step 3b reads a taken column.
        ctx.farRoleIdMap.set(`${m.name}::${c}`, roleIds[i]!);
      }
    }
    // The key's uniqueness identifies the objectifier, as the DDL import
    // reads it (import-key-identifier-follow-ups.spec.md, barwise-fuo).
    const key = factType.addConstraint({
      type: "internal_uniqueness",
      roleIds: info.roles.flatMap(([c], i) => (info.key.includes(c!) ? [roleIds[i]!] : [])),
    });
    for (const { role, values } of valueConstraints) {
      factType.addConstraint({ type: "value_constraint", roleId: roleIds[role]!, values });
    }
    if (info.objectified && entityId) {
      ctx.model.addObjectifiedFactType({ factTypeId: factType.id, objectTypeId: entityId });
      // Checked as the DDL import checks it (`preferUniquenessOver`), so a
      // key the reading ever widens past a reference scheme stores nothing
      // rather than an identifier validation refuses.
      ctx.model.setPreferredIdentifier(entityId, key.id!);
      if (!resolvePreferredIdentifier(ctx.model, entityId).ok) {
        ctx.model.setPreferredIdentifier(entityId, undefined);
      }
    }
  }
}
