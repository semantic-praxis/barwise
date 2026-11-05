#!/usr/bin/env node
/**
 * adr-probes -- replay each ADR decision's recorded violation against the
 * gate its `Enforced-by:` header declares, and report whether the gate
 * went red (docs/specs/enforceable-adr-practice.spec.md, WS5).
 *
 * check:architecture and check:adr-model hold a declared gate to existing
 * and running in CI. Neither can tell a gate that fails when its decision
 * is broken from one that only runs beside it: a proxy declaration got
 * through a WS3 batch and was caught only by review (#886). A probe in
 * barwise/docs/adr/probes.json states one violation of one decision, as
 * an edit to one file, and this runs it through mutate.mjs with
 * --expect-exit 1 against every `npm` entry that lists the decision, with
 * the entry's own script and `-- <args>`, so a probe runs what the header
 * declares and CI runs.
 *
 * A row is either a probe, `{ decision, file, old, new }`, or a decision
 * left unprobed with its reason, `{ decision, unprobed }`: a gate that
 * reads committed state (check:plan-review) never sees a working-tree
 * edit, so a probe of it would read as a proxy that is not one.
 *
 * On demand, not in CI (the spec's open decision): each probe is a gate
 * run unmutated and one mutated, in sequence, since each edits the tree.
 *
 * Exit codes (docs/adr/gate-refusal-contract.md):
 *   0  every probe CAUGHT
 *   1  a finding: a row naming a decision no ADR has or no `npm` entry
 *      lists (reported before anything runs), or a probe MISSED -- the
 *      gate did not exit 1 on the violation
 *   2  could not answer, with no finding: the manifest would not read, a
 *      probed file has uncommitted changes, mutate.mjs refused (anchor
 *      absent or ambiguous, gate red unmutated, gate refused), or there
 *      is no probe at all
 *
 * Usage: node scripts/adr-probes.mjs [--root <repo>] [--only <decision>]
 */
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const say = (s) => console.error(`adr-probes: ${s}`);
function refuse(message) {
  say(`cannot answer: ${message}`);
  process.exit(2);
}

/** The manifest path, from the repository root. */
export const MANIFEST = "barwise/docs/adr/probes.json";

const isText = (v) => typeof v === "string" && v !== "";

/**
 * The manifest's rows, or a problem that makes the whole file unreadable
 * (a refusal: nothing in it can be trusted to mean what it says).
 */
export function readRows(text) {
  let rows;
  try {
    rows = JSON.parse(text);
  } catch (err) {
    return { problem: `${MANIFEST} is not JSON (${err instanceof Error ? err.message : err})` };
  }
  if (!Array.isArray(rows)) return { problem: `${MANIFEST} is not an array of rows` };
  for (const [i, r] of rows.entries()) {
    const probe = r !== null && typeof r === "object"
      && isText(r.decision) && isText(r.file) && typeof r.old === "string"
      && r.old !== "" && typeof r.new === "string" && r.unprobed === undefined;
    const unprobed = r !== null && typeof r === "object"
      && isText(r.decision) && isText(r.unprobed) && r.file === undefined;
    if (!probe && !unprobed) {
      return {
        problem: `${MANIFEST} row ${i + 1} is neither { decision, file, old, new }`
          + " nor { decision, unprobed }",
      };
    }
  }
  return { rows };
}

/**
 * Each decision's declared gates, from the ADRs' headers:
 * `{ ids: Map<"<adr>#<id>", true>, gates: Map<"<adr>#<id>", entry[]> }`,
 * an entry being `{ script, args, text }`.
 */
export function declaredGates(adrs, { parseEnforcedBy, decisionIds, ADR_DIR }) {
  const ids = new Set();
  const gates = new Map();
  for (const { f, text } of adrs) {
    const adr = f.slice(ADR_DIR.length, -".md".length);
    for (const d of decisionIds(text).decisions) if (d.id !== null) ids.add(`${adr}#${d.id}`);
    for (const e of parseEnforcedBy(text).entries) {
      if (e.kind !== "npm") continue;
      for (const id of new Set(e.ids)) {
        const key = `${adr}#${id}`;
        if (!gates.has(key)) gates.set(key, []);
        gates.get(key).push({ script: e.script, args: e.args, text: e.text });
      }
    }
  }
  return { ids, gates };
}

/** The rows' findings: a decision with no declared gate to probe. */
export function rowFindings(rows, { ids, gates }) {
  const out = [];
  for (const r of rows) {
    if (!ids.has(r.decision)) out.push(`${r.decision}: no ADR has this decision`);
    else if (!gates.has(r.decision)) {
      out.push(`${r.decision}: no npm entry of its ADR lists it, so there is no gate to probe`);
    }
  }
  return out;
}

async function main() {
  let root, only, args, enforcement, section;
  try {
    ({ opt: args } = await import("./lib/args.mjs"));
    root = resolve(args("--root") ?? join(here, "..", ".."));
    only = args("--only");
    enforcement = await import("./lib/adr-enforcement.mjs");
    section = await import("./lib/architecture-section.mjs");
  } catch (err) {
    refuse(err instanceof Error ? err.message : String(err));
  }
  const { readFileSync } = await import("node:fs");
  const { isAdr, readFiles, trackedPaths, ADR_DIR } = section;

  let text;
  try {
    text = readFileSync(join(root, MANIFEST), "utf8");
  } catch (err) {
    refuse(`${MANIFEST} would not read (${err instanceof Error ? err.message : err})`);
  }
  const read = readRows(text);
  if (read.problem) refuse(read.problem);
  const declared = declaredGates(readFiles(root, trackedPaths(root).filter(isAdr)), {
    ...enforcement,
    ADR_DIR,
  });

  const findings = rowFindings(read.rows, declared);
  if (findings.length > 0) {
    say(`FAIL -- ${findings.length} row(s) of ${MANIFEST} name no declared gate:`);
    for (const f of findings) console.error(`  ${f}`);
    process.exit(1);
  }

  const probes = read.rows.filter((r) => r.file !== undefined)
    .filter((r) => only === null || r.decision === only);
  if (probes.length === 0) refuse(`no probe to run${only === null ? "" : ` for ${only}`}`);

  const lines = [];
  const missed = [];
  const refused = [];
  for (const p of probes) {
    // mutate.mjs restores the bytes it found, committed or not, so a dirty
    // file would be judged as a tree nobody committed.
    let dirty;
    try {
      dirty = execFileSync("git", ["-C", root, "status", "--porcelain", "--", p.file], {
        encoding: "utf8",
      }).trim() !== "";
    } catch (err) {
      refuse(`git status failed for ${p.file} (${err instanceof Error ? err.message : err})`);
    }
    for (const gate of declared.gates.get(p.decision)) {
      const label = `${p.decision} by "${gate.text}"`;
      if (dirty) {
        refused.push(`${label}: ${p.file} has uncommitted changes`);
        continue;
      }
      const command = ["npm", "run", "--silent", gate.script];
      if (gate.args !== null) command.push("--", ...gate.args.split(/\s+/));
      const run = spawnSync(
        process.execPath,
        [
          join(here, "mutate.mjs"),
          "--file",
          join(root, p.file),
          "--old",
          p.old,
          "--new",
          p.new,
          "--expect-exit",
          "1",
          "--",
          ...command,
        ],
        { cwd: join(root, "barwise"), encoding: "utf8" },
      );
      const last = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim().split("\n")
        .filter((l) => l.startsWith("mutate:")).at(-1) ?? "mutate printed no verdict";
      if (run.status === 0) lines.push(`  CAUGHT   ${label}`);
      else if (run.status === 1) {
        lines.push(`  MISSED   ${label}`);
        missed.push(`${label}: ${last}`);
      } else {
        lines.push(`  REFUSED  ${label}`);
        refused.push(`${label}: ${last}`);
      }
    }
  }

  const probed = new Set(read.rows.map((r) => r.decision));
  const reasons = new Map(read.rows.filter((r) => r.unprobed).map((r) => [r.decision, r.unprobed]));
  const unprobed = [...declared.gates.keys()].filter((k) => !probed.has(k) || reasons.has(k));

  console.log(`adr-probes: ${probes.length} probe(s):`);
  for (const l of lines) console.log(l);
  if (only === null && unprobed.length > 0) {
    console.log(`Declared gates with no probe (${unprobed.length}), not judged:`);
    for (const k of unprobed) console.log(`  ${k}${reasons.has(k) ? `: ${reasons.get(k)}` : ""}`);
  }
  if (missed.length > 0) {
    say(`FAIL -- ${missed.length} declared gate(s) did not go red on their decision's violation:`);
    for (const m of missed) console.error(`  ${m}`);
    for (const r of refused) console.error(`  cannot answer: ${r}`);
    process.exit(1);
  }
  if (refused.length > 0) {
    say("cannot answer for these probes:");
    for (const r of refused) console.error(`  ${r}`);
    process.exit(2);
  }
  console.log("adr-probes: every probe's gate went red on its violation. OK");
}

// Imported for its helpers by the tests; run as a script otherwise.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    refuse(`an unexpected error: ${err instanceof Error ? err.stack ?? err.message : err}`);
  }
}
