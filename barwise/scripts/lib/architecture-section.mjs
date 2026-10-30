/**
 * The generated first section of barwise/docs/ARCHITECTURE.md: the ADR
 * index and a rendering of INTENDED (docs/specs/architecture-index.spec.md,
 * WS3). One reader of the inputs and one renderer, for the writer
 * (scripts/regen-architecture.mjs) and the check (check:architecture), so
 * "stale" means one thing: a writer that read its inputs another way would
 * write a section the check calls stale and no run could make current.
 *
 * Lists, never tables: dprint realigns a table's padding, and the check
 * compares the section byte for byte with what this renders.
 */
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { parseEnforcedBy } from "./adr-enforcement.mjs";
import { header } from "./spec-reader.mjs";

export const BEGIN =
  "<!-- BEGIN regen:architecture -- generated; edit the ADRs or INTENDED, then run npm run regen:architecture -->";
export const END = "<!-- END regen:architecture -->";

export const ADR_DIR = "barwise/docs/adr/";
/** An ADR, by repo-relative path: at any depth under ADR_DIR, its README aside. */
export const isAdr = (f) => f.startsWith(ADR_DIR) && f.endsWith(".md") && !f.endsWith("/README.md");

export const isMap = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * The paths git tracks under `root` -- the tree CI checks -- always read
 * with `git -C root`, so the listing and the files read are one tree
 * whatever the cwd. A repository always tracks files, so an empty listing
 * is git answering emptily, and it throws.
 */
export function trackedPaths(root) {
  const out = execFileSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  if (out.length === 0) throw new Error(`git ls-files lists nothing under ${root}`);
  return out;
}

/**
 * [{ f, text }] for each path that is a regular file on disk. A tracked
 * path that is not one is being deleted, or is a symlink or gitlink: it is
 * not read, because reading it would turn the run into exit 2 and hide the
 * references a deletion left dead.
 */
export function readFiles(root, paths) {
  const isFile = (p) => {
    try {
      return lstatSync(p).isFile();
    } catch {
      return false;
    }
  };
  return paths.filter((f) => isFile(join(root, f))).map((f) => ({
    f,
    text: readFileSync(join(root, f), "utf8"),
  }));
}

/** INTENDED under `root`, refused unless it is a non-empty map of package to package list. */
export function loadIntended(root) {
  const path = join(root, "barwise", "scripts", "lib", "intended.cjs");
  const intended = createRequire(import.meta.url)(path);
  const shape = isMap(intended) && Object.keys(intended).length > 0
    && Object.values(intended).every(
      (v) => Array.isArray(v) && v.every((d) => typeof d === "string"),
    );
  if (!shape) throw new Error(`${path} does not export a map of package to package list`);
  return intended;
}

/**
 * What an ADR's `Enforced-by:` header declares, as the index shows it, or
 * "" for an ADR without one (docs/specs/executable-adrs.spec.md, WS4). Read
 * from the ADR's own text through parseEnforcedBy(), the reader the check
 * uses, so the index never reads ci.yml or the tracker and cannot show an
 * entry differently from how the check reads it. An entry that does not
 * parse is left out here; check:architecture reports it.
 *
 *   declared: purity (no-io, no-clock), tests (pure-ids); gap: barwise-k3x (same-output)
 */
export function enforcementLine(text) {
  const { present, entries } = parseEnforcedBy(text);
  if (!present) return "";
  const ids = (e) => `(${e.ids.join(", ")})`;
  const declared = entries.filter((e) => e.kind !== "none").map((e) =>
    e.kind === "tests" ? `tests ${ids(e)}` : `${e.script} ${ids(e)}`
  );
  const parts = [
    ...(declared.length > 0 ? [`declared: ${declared.join(", ")}`] : []),
    ...entries.filter((e) => e.kind === "none").map((e) => `gap: ${e.issue} ${ids(e)}`),
  ];
  return parts.join("; ");
}

/**
 * The section, markers included. `adrs` is [{ f, text }] with `f` the path
 * relative to the repo root, in path order (both callers read git ls-files,
 * which sorts); `intended` is the INTENDED
 * map.
 */
export function renderSection(adrs, intended) {
  const entries = adrs.map(({ f, text }) => ({
    title: /^# (.+)$/m.exec(text)?.[1].trim() ?? f,
    link: f.replace(/^barwise\/docs\//, ""),
    scope: header(text, "Scope"),
    date: header(text, "Date"),
    enforcement: enforcementLine(text),
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
  // Said once, and only when some ADR declares: what "declared" means and
  // the two limits under it (the spec, "What does executable buy").
  if (entries.some((e) => e.enforcement !== "")) {
    out.push(
      "",
      "After an ADR's date: `declared:` names the gates and tagged tests its",
      "`Enforced-by:` header lists, which `check:architecture` and",
      "`check:adr-tests` hold to existing and running in CI, not to catching a",
      "violation; `gap:` names the open issue for a decision nothing enforces",
      "yet. A declared gate blocks a merge only if `main` requires the `ci`",
      "check (barwise-raw), and most gates skip a docs-only change.",
    );
  }
  for (const scope of ["architecture", "process"]) {
    const rows = entries.filter((e) => e.scope === scope);
    if (rows.length === 0) continue;
    out.push("", `${scope[0].toUpperCase()}${scope.slice(1)}:`, "");
    for (const e of rows) {
      out.push(
        `- [${e.title}](${e.link}) -- ${e.date}${e.enforcement ? ` -- ${e.enforcement}` : ""}`,
      );
    }
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
  // END is looked for after BEGIN, so prose quoting the END marker above
  // the section does not hide it.
  const b = a === -1 ? -1 : doc.indexOf(END, a);
  if (b === -1) return null;
  return doc.slice(a, b + END.length);
}
