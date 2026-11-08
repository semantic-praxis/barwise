#!/usr/bin/env node
// Eval-coverage gate -- docs/specs/adr-batch9-enforcers.spec.md, WS5.
//
// Holds the three decisions of ADR constraint-coverage-policy, which share
// three inputs and so one gate:
//
//   the suite       barwise/packages/promptlab/evals/ (suite.yaml, each
//                   case's *.eval.yaml and *.reference.orm.yaml)
//   the ADR         docs/adr/constraint-coverage-policy.md (decision 2's
//                   tiers, read from its own backticks)
//   the inventory   docs/specs/constraint-extraction-coverage.spec.md (one
//                   row per constraint type)
//
// It is a script, not a promptlab vitest test, because turbo caches a test
// against its own package's inputs: a test there replays a cached pass when
// only the ADR or the inventory changed, which is the change it guards.
//
// - `two-instances`: a type is `covered: yes` exactly when some train case
//   and some dev case each rubric-test it. A case counts as its own domain
//   (owner, 2026-11-06), and a case is in one split, so "different cases"
//   follows from one train plus one dev. Phrasing stays review's.
// - `tiered-types`: no reference in the suite carries a rare-tier
//   constraint, and no ring check resolves to a rare-tier ring type. What
//   it cannot hold is the decision's object, a transcript: barwise-ym8.vq8
//   stays open on transcript prose that settles a rare-tier rule.
// - `inventory-outside`: the inventory's tier, reference-case and
//   rubric-tested columns equal what the suite and the ADR derive.
//
// A `forbids_population` ring check names a fact type, not a ring type. The
// ring type it tests is resolved through `referenceConstraint` from
// @barwise/learn, the function the evaluator itself selects with, so the
// gate cannot disagree with the evaluator about which of two rings on one
// fact type is the tested one. The kinds other than `ring` name no
// inventory type, and set-comparison has no check kind at all
// (constraint-extraction-coverage.spec.md, workstream 3), so those three
// types only ever appear as a reference column.
//
// Exit 0 no findings, 1 findings, 2 could not answer: core or learn not
// built, an input unreadable, a parse that finds no tier, a RingType member
// or type with no tier, a case in no split, or a check naming a fact type
// or ring its reference lacks.
//
// Usage: node barwise/scripts/check-eval-coverage.mjs
//        [--root <repo>] [--core <path>] [--learn <path>]
// --core and --learn name the built entry points (default
// barwise/packages/{core,learn}/dist/index.js), so a test can make an
// import fail; --root names a fixture repository.

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** The three set-comparison types, which share the inventory with the rings. */
export const SET_TYPES = ["subset", "equality", "exclusion"];

/** The inventory's columns, by the header text the gate looks for. */
const COLUMNS = {
  type: "type",
  tier: "tier",
  refs: "reference cases",
  train: "rubric-tested train cases",
  dev: "rubric-tested dev cases",
  covered: "covered",
};

/** A refusal: the gate could not answer, which is not a finding. */
export class Refusal extends Error {}

const squash = (text) => text.replace(/\s+/g, " ");
const ticked = (text) => [...text.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);

/**
 * Decision 2's tiers from the ADR's own text: the backticked names before
 * the first " -- " of the common-tier and the rare-tier sentences.
 * Returns `Map<type, "common" | "rare">`. A name that is no known type, in
 * both tiers, or a tier that lists nothing, or a known type with no tier, is
 * a refusal: the gate cannot tell a tier from its absence.
 */
export function parseTiers(adrText, knownTypes) {
  const m = /\*\*Types are tiered[\s\S]*?(?=\n\d+\. \*\*|\n## |$)/.exec(adrText);
  if (m === null) throw new Refusal('the ADR has no decision 2 ("Types are tiered").');
  const text = squash(m[0]);
  const common = /Common tier\b(.*?)\bRare tier\b/.exec(text);
  const rare = /\bRare tier\b(.*?)(?:Their home|$)/.exec(text);
  if (common === null || rare === null) {
    throw new Refusal('decision 2 names no "Common tier" followed by a "Rare tier".');
  }
  const listed = (segment) => ticked(segment.split(" -- ")[0]);
  const tiers = new Map();
  for (const [tier, segment] of [["common", common[1]], ["rare", rare[1]]]) {
    const names = listed(segment);
    if (names.length === 0) throw new Refusal(`decision 2's ${tier} tier lists no type.`);
    for (const name of names) {
      if (!knownTypes.includes(name)) {
        throw new Refusal(`decision 2 tiers \`${name}\`, which is no ring or set-comparison type.`);
      }
      if (tiers.has(name)) throw new Refusal(`decision 2 tiers \`${name}\` twice.`);
      tiers.set(name, tier);
    }
  }
  const missing = knownTypes.filter((t) => !tiers.has(t));
  if (missing.length > 0) {
    throw new Refusal(`decision 2 gives no tier to ${missing.map((t) => `\`${t}\``).join(", ")}.`);
  }
  return tiers;
}

/**
 * The inventory's rows, by type: `{ tier, refs, train, dev, covered }`, the
 * counts as the raw cell text (a bad count is a finding on that row, not a
 * parse failure). The table is the one whose header has the Type, Tier and
 * Covered columns; the prose column beside them is ignored. No such table,
 * or one missing a column, is a refusal.
 */
export function parseInventory(specText) {
  const lines = specText.split("\n");
  const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trimStart().startsWith("|")) continue;
    const header = cells(lines[i]).map((c) => c.toLowerCase());
    if (!header.includes(COLUMNS.type) || !header.includes(COLUMNS.covered)) continue;
    const at = {};
    for (const [key, name] of Object.entries(COLUMNS)) {
      at[key] = header.indexOf(name);
      if (at[key] === -1) {
        throw new Refusal(`the inventory table has no "${name}" column.`);
      }
    }
    const rows = new Map();
    const duplicates = [];
    for (let j = i + 2; j < lines.length && lines[j].trimStart().startsWith("|"); j++) {
      const row = cells(lines[j]);
      const type = (row[at.type] ?? "").replace(/`/g, "");
      if (rows.has(type)) duplicates.push(type);
      rows.set(type, Object.fromEntries(Object.keys(COLUMNS).map((k) => [k, row[at[k]] ?? ""])));
    }
    if (rows.size === 0) throw new Refusal("the inventory table has no rows.");
    return { rows, duplicates };
  }
  throw new Refusal("no inventory table (a header with Type, Tier and Covered columns).");
}

/**
 * Counts per type from the measured cases. A case is `{ id, split, types,
 * rubric }`: `types` the set of inventory types its reference carries, and
 * `rubric` the ring types its `forbids_population` ring checks resolve to.
 * `refs`, `train` and `dev` count cases, not constraints: a case is its own
 * domain, and two checks of one type in one case are one instance.
 */
export function tally(cases, types) {
  const out = new Map(types.map((t) => [t, { refs: 0, train: 0, dev: 0 }]));
  for (const c of cases) {
    for (const t of types) {
      if (c.types.has(t)) out.get(t).refs++;
      if (c.rubric.includes(t)) out.get(t)[c.split]++;
    }
  }
  return out;
}

const COUNT = /^\d+$/;

/** Every finding, as `rule  message`, in a stable order. */
export function findings({ cases, tiers, inventory, types }) {
  const out = [];
  const counts = tally(cases, types);
  for (const c of cases) {
    for (const t of types) {
      if (tiers.get(t) !== "rare") continue;
      if (c.types.has(t)) {
        out.push(
          `tiered-types  ${c.id}: the reference carries rare-tier \`${t}\`; a rare type never enters an eval transcript`,
        );
      }
      if (c.rubric.includes(t)) {
        out.push(
          `tiered-types  ${c.id}: a forbids_population ring check resolves to rare-tier \`${t}\``,
        );
      }
    }
  }
  for (const dup of inventory.duplicates) {
    out.push(`inventory-outside  \`${dup}\` has more than one inventory row`);
  }
  for (const t of types) {
    const row = inventory.rows.get(t);
    const have = counts.get(t);
    if (row === undefined) {
      out.push(`inventory-outside  \`${t}\` has no inventory row`);
      continue;
    }
    if (row.tier.toLowerCase() !== tiers.get(t)) {
      out.push(
        `inventory-outside  \`${t}\`: tier "${row.tier}" but the ADR says "${tiers.get(t)}"`,
      );
    }
    for (
      const [key, label] of [["refs", "reference cases"], [
        "train",
        "rubric-tested train cases",
      ], ["dev", "rubric-tested dev cases"]]
    ) {
      if (!COUNT.test(row[key])) {
        out.push(`inventory-outside  \`${t}\`: "${label}" is "${row[key]}", not a count`);
      } else if (Number(row[key]) !== have[key]) {
        out.push(
          `inventory-outside  \`${t}\`: "${label}" says ${row[key]}, the suite has ${have[key]}`,
        );
      }
    }
    const says = row.covered.toLowerCase();
    const owed = have.train >= 1 && have.dev >= 1;
    if (says !== "yes" && says !== "no") {
      out.push(`two-instances  \`${t}\`: "covered" is "${row.covered}", not yes or no`);
    } else if ((says === "yes") !== owed) {
      out.push(
        `two-instances  \`${t}\`: marked ${says === "yes" ? "covered" : "not covered"} `
          + `with ${have.train} train, ${have.dev} dev (covered means at least one of each)`,
      );
    }
  }
  for (const t of inventory.rows.keys()) {
    if (!types.includes(t)) {
      out.push(`inventory-outside  \`${t}\` is a row but no ring or set-comparison type`);
    }
  }
  return out;
}

/**
 * Read the suite into cases. Everything it cannot resolve is a refusal: a
 * count over a suite it half-read would be a confident wrong answer.
 */
export function measureSuite({ evalsDir, core, learn, YAML }) {
  const read = (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch (err) {
      throw new Refusal(`${path} would not read (${err.message}).`);
    }
  };
  const parse = (path) => {
    try {
      return YAML.parse(read(path));
    } catch (err) {
      if (err instanceof Refusal) throw err;
      throw new Refusal(`${path} would not parse (${err.message}).`);
    }
  };
  const suite = parse(join(evalsDir, "suite.yaml"));
  const files = suite?.cases;
  if (!Array.isArray(files) || files.length === 0) {
    throw new Refusal("suite.yaml lists no cases.");
  }
  const splitOf = new Map();
  for (const split of ["train", "dev"]) {
    for (const id of suite.splits?.[split] ?? []) splitOf.set(id, split);
  }
  const serializer = new core.OrmYamlSerializer();
  const cases = [];
  for (const file of files) {
    const id = String(file).replace(/\.eval\.yaml$/, "");
    const split = splitOf.get(id);
    if (split === undefined) throw new Refusal(`case ${id} is in neither the train nor dev split.`);
    const doc = parse(join(evalsDir, file));
    const types = new Set();
    const rubric = [];
    if (doc?.reference !== undefined) {
      const refPath = join(evalsDir, dirname(file), doc.reference);
      let model;
      try {
        model = serializer.deserialize(read(refPath));
      } catch (err) {
        if (err instanceof Refusal) throw err;
        throw new Refusal(`${refPath} would not load (${err.message}).`);
      }
      const constraints = [
        ...model.factTypes.flatMap((ft) => [...ft.internalConstraints]),
        ...model.constraints,
      ];
      for (const c of constraints) {
        // A join form states the same type over a path of fact types, so a
        // join_ring's ring type and a join_subset's subset count as theirs
        // (code review: a rare-tier join_ring otherwise passed unseen).
        const base = c.type.startsWith("join_") ? c.type.slice("join_".length) : c.type;
        if (base === "ring") types.add(c.ringType);
        else if (SET_TYPES.includes(base)) types.add(base);
      }
      for (const check of doc.checks ?? []) {
        if (check?.kind !== "forbids_population" || check.constraint !== "ring") continue;
        const ft = model.getFactTypeByName(check.factType);
        if (ft === undefined) {
          throw new Refusal(
            `${id}: a ring check names "${check.factType}", which its reference lacks.`,
          );
        }
        const ring = learn.referenceConstraint(ft, "ring");
        if (ring === undefined) {
          throw new Refusal(`${id}: a ring check names "${check.factType}", which has no ring.`);
        }
        rubric.push(ring.ringType);
      }
    } else if ((doc?.checks ?? []).some((c) => c?.kind === "forbids_population")) {
      throw new Refusal(`${id}: a forbids_population check with no reference.`);
    }
    cases.push({ id, split, types, rubric });
  }
  return cases;
}

function refuse(message) {
  process.stderr.write(
    `check:eval-coverage: cannot answer: ${message}\n`
      + "  Refusing rather than printing OK over input it did not read.\n",
  );
  process.exit(2);
}

async function main() {
  let root, corePath, learnPath;
  try {
    const { opt } = await import("./lib/args.mjs");
    root = resolve(opt("--root") ?? join(here, "..", ".."));
    // Core and learn are code, not inputs of the tree being judged: found
    // beside this script, so --root names a fixture without a build in it.
    corePath = opt("--core") ?? join(here, "..", "packages", "core", "dist", "index.js");
    learnPath = opt("--learn") ?? join(here, "..", "packages", "learn", "dist", "index.js");
  } catch (err) {
    refuse(err.message);
  }
  const load = (p) => import(pathToFileURL(isAbsolute(p) ? p : resolve(p)).href);
  let core, learn, YAML;
  try {
    core = await load(corePath);
    learn = await load(learnPath);
    YAML = (await import("yaml")).default;
  } catch (err) {
    refuse(
      `a dependency would not load (${err instanceof Error ? err.message : String(err)}).\n`
        + "  @barwise/core and @barwise/learn must be built first: npm run build.",
    );
  }
  if (typeof learn.referenceConstraint !== "function" || !Array.isArray(core.RING_TYPES)) {
    refuse("the built core or learn lacks RING_TYPES or referenceConstraint; rebuild them.");
  }
  const types = [...core.RING_TYPES, ...SET_TYPES];
  const at = (...p) => join(root, "barwise", ...p);
  let result;
  try {
    const adr = readFileSync(at("docs", "adr", "constraint-coverage-policy.md"), "utf8");
    const spec = readFileSync(
      at("docs", "specs", "constraint-extraction-coverage.spec.md"),
      "utf8",
    );
    const tiers = parseTiers(adr, types);
    const inventory = parseInventory(spec);
    const cases = measureSuite({
      evalsDir: at("packages", "promptlab", "evals"),
      core,
      learn,
      YAML,
    });
    result = { cases, found: findings({ cases, tiers, inventory, types }) };
  } catch (err) {
    refuse(err instanceof Refusal ? err.message : `an input would not read (${err.message}).`);
  }
  const { cases, found } = result;
  if (found.length === 0) {
    const n = (s) => cases.filter((c) => c.split === s).length;
    console.warn(
      `check:eval-coverage: OK -- ${cases.length} case(s) (${n("train")} train, ${n("dev")} dev); `
        + `${types.length} type(s) tiered by the ADR; the inventory agrees with the suite.`,
    );
    process.exit(0);
  }
  console.error(`check:eval-coverage: ${found.length} finding(s):`);
  for (const f of found) console.error(`  ${f}`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
