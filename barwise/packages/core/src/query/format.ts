/**
 * Symbolic model query API: human-readable result formatter.
 *
 * `formatQueryResult` renders a {@link QueryResult} as plain text for
 * CLI output. Programmatic consumers should use the structured result
 * directly rather than parsing this text.
 */

import type { ConstraintRef, EntityRef, FactTypeRef, QueryResult, RoleRef } from "./types.js";

/** Render a {@link QueryResult} as a plain-text block (no trailing newline). */
export function formatQueryResult(result: QueryResult): string {
  switch (result.kind) {
    case "entities":
      return formatList(
        `Object types (${result.entities.length})`,
        result.entities.map(formatEntityLine),
      );

    case "fact-types":
      return formatList(
        `Fact types (${result.factTypes.length})`,
        result.factTypes.map(formatFactTypeLine),
      );

    case "constraints":
      return formatList(
        `Constraints (${result.constraints.length})`,
        result.constraints.map(formatConstraintLine),
      );

    case "roles":
      return formatList(
        `Roles (${result.roles.length})`,
        result.roles.map(formatRoleLine),
      );

    case "entity-detail": {
      const d = result.detail;
      const lines: string[] = [];
      lines.push(`Entity: ${d.entity.name} (${d.entity.entityKind})`);
      if (d.entity.referenceMode) {
        lines.push(`  Reference mode: ${d.entity.referenceMode}`);
      }
      if (d.entity.definition) {
        lines.push(`  Definition: ${d.entity.definition}`);
      }
      lines.push("");
      lines.push(...section("Fact types", d.factTypes.map(formatFactTypeLine)));
      lines.push(...section("Roles played", d.roles.map(formatRoleLine)));
      lines.push(...section("Constraints", d.constraints.map(formatConstraintLine)));
      lines.push(...section("Subtypes", d.subtypes.map((e) => e.name)));
      lines.push(...section("Supertypes", d.supertypes.map((e) => e.name)));
      return lines.join("\n").trimEnd();
    }

    case "fact-type-detail": {
      const d = result.detail;
      const lines: string[] = [];
      lines.push(`Fact type: ${d.factType.name}`);
      lines.push(`  Arity: ${d.factType.arity}`);
      lines.push(`  Reading: ${d.factType.reading}`);
      if (d.objectified) lines.push(`  Objectified: yes`);
      lines.push("");
      lines.push(...section("Roles", d.roles.map(formatRoleLine)));
      lines.push(...section("Readings", [...d.readings]));
      lines.push(...section("Constraints", d.constraints.map(formatConstraintLine)));
      return lines.join("\n").trimEnd();
    }

    case "path": {
      if (!result.found) {
        return `No path found between "${result.from}" and "${result.to}".`;
      }
      if (result.steps.length === 0) {
        return `"${result.from}" and "${result.to}" are the same entity.`;
      }
      const lines: string[] = [];
      lines.push(
        `Path from "${result.from}" to "${result.to}" `
          + `(${result.steps.length} step${result.steps.length === 1 ? "" : "s"}):`,
      );
      for (const step of result.steps) {
        lines.push(`  ${step.from} -> ${step.to}  via ${step.factType.name}`);
      }
      return lines.join("\n");
    }

    case "stats": {
      const s = result.stats;
      const lines: string[] = [];
      lines.push(`Model: ${s.modelName}`);
      if (s.domainContext) lines.push(`Context: ${s.domainContext}`);
      lines.push(`  Entity types:           ${s.entityTypes}`);
      lines.push(`  Value types:            ${s.valueTypes}`);
      lines.push(`  Fact types:             ${s.factTypes}`);
      lines.push(`  Constraints:            ${s.constraints}`);
      lines.push(`  Subtype relationships:  ${s.subtypeRelationships}`);
      lines.push(`  Objectified fact types: ${s.objectifiedFactTypes}`);
      lines.push(`  Populations:            ${s.populations}`);
      return lines.join("\n");
    }

    case "not-found":
      return result.message;
  }
}

// ---------------------------------------------------------------------------
// Line and section helpers
// ---------------------------------------------------------------------------

function formatEntityLine(e: EntityRef): string {
  const def = e.definition ? ` -- ${e.definition}` : "";
  return `${e.name} (${e.entityKind})${def}`;
}

function formatFactTypeLine(ft: FactTypeRef): string {
  return `${ft.reading}  [arity ${ft.arity}]`;
}

function formatConstraintLine(c: ConstraintRef): string {
  return `[${c.constraintType}] ${c.verbalization}`;
}

function formatRoleLine(r: RoleRef): string {
  return `${r.name} (played by ${r.player}) in ${r.factType}`;
}

function formatList(header: string, items: readonly string[]): string {
  if (items.length === 0) return `${header}: none`;
  return [`${header}:`, ...items.map((i) => `  ${i}`)].join("\n");
}

function section(header: string, items: readonly string[]): string[] {
  if (items.length === 0) return [`${header}: none`, ""];
  return [`${header}:`, ...items.map((i) => `  ${i}`), ""];
}
