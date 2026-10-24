/**
 * The generated first section of barwise/docs/ARCHITECTURE.md: the ADR
 * index and a rendering of INTENDED (docs/specs/architecture-index.spec.md,
 * WS3). One renderer for the writer (scripts/regen-architecture.mjs) and
 * the reader (check:architecture), so "stale" means one thing.
 *
 * Lists, never tables: dprint realigns a table's padding, and the check
 * compares the section byte for byte with what this renders.
 */
import { header } from "./spec-reader.mjs";

export const BEGIN =
  "<!-- BEGIN regen:architecture -- generated; edit the ADRs or INTENDED, then run npm run regen:architecture -->";
export const END = "<!-- END regen:architecture -->";

/**
 * The section, markers included. `adrs` is [{ f, text }] with `f` the path
 * relative to the repo root, in path order (both callers list a sorted
 * directory: readdir sorted, and git ls-files); `intended` is the INTENDED
 * map.
 */
export function renderSection(adrs, intended) {
  const entries = adrs.map(({ f, text }) => ({
    title: /^# (.+)$/m.exec(text)?.[1].trim() ?? f,
    link: f.replace(/^barwise\/docs\//, ""),
    scope: header(text, "Scope"),
    date: header(text, "Date"),
  }));
  const out = [
    BEGIN,
    "",
    "## Current architecture",
    "",
    "This section is current and generated, from the ADRs in `docs/adr/` and",
    "`INTENDED` in `barwise/scripts/lib/intended.cjs`; `npm run",
    "check:architecture` fails when it is stale. Everything below it is the",
    "February 2026 design record.",
    "",
    "### Decisions",
  ];
  for (const scope of ["architecture", "process"]) {
    const rows = entries.filter((e) => e.scope === scope);
    if (rows.length === 0) continue;
    out.push("", `${scope[0].toUpperCase()}${scope.slice(1)}:`, "");
    for (const e of rows) out.push(`- [${e.title}](${e.link}) -- ${e.date}`);
  }
  out.push(
    "",
    "### Package graph",
    "",
    "Each package and the internal packages it may import:",
    "",
  );
  for (const [pkg, deps] of Object.entries(intended)) {
    out.push(`- \`${pkg}\`: ${deps.length === 0 ? "none" : deps.join(", ")}`);
  }
  out.push("", END);
  return out.join("\n");
}

/** The section as it stands in `doc`, markers included, or null when absent. */
export function currentSection(doc) {
  const a = doc.indexOf(BEGIN);
  const b = doc.indexOf(END);
  if (a === -1 || b === -1 || b < a) return null;
  return doc.slice(a, b + END.length);
}
