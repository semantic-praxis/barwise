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
 *      lists, or one both probed and unprobed (reported before anything
 *      runs); a probe MISSED -- the gate did not fail on the violation; or
 *      OFF-CODE -- it failed with a code other than 1, which the refusal
 *      contract misreads (barwise-vt2), a finding about the gate, not a proxy
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
 * `{ ids: Set<"<adr>#<id>">, gates: Map<"<adr>#<id>", entry[]> }`,
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

/**
 * The rows' findings: a decision with no declared gate to probe, or one
 * both probed and declared unprobed, which would read as both.
 */
export function rowFindings(rows, { ids, gates }) {
  const out = [];
  const unprobed = new Set(rows.filter((r) => r.unprobed !== undefined).map((r) => r.decision));
  for (const r of rows) {
    if (!ids.has(r.decision)) out.push(`${r.decision}: no ADR has this decision`);
    else if (!gates.has(r.decision)) {
      out.push(`${r.decision}: no npm entry of its ADR lists it, so there is no gate to probe`);
    } else if (r.file !== undefined && unprobed.has(r.decision)) {
      out.push(`${r.decision}: has a probe and an unprobed row; keep one`);
    }
  }
  return out;
}

/**
 * The header's `-- <args>` as argv, or null when they hold a quote or a
 * backslash: CI's shell would unquote them, and splitting on spaces here
 * would probe a different command than the one declared.
 */
export function argv(args) {
  if (args === null) return [];
  if (/["'\\`$]/.test(args)) return null;
  return ["--", ...args.split(/\s+/)];
}

/**
 * mutate.mjs's verdict, from its exit status and its last `mutate:` line.
 * An exit 1 that names another code is a gate that went red off the
 * refusal contract (depcruise's violation count, barwise-vt2): not a
 * proxy, and not reported as one.
 */
export function verdict(status, last) {
  if (status === 0) return "CAUGHT";
  if (status === 1) {
    return /failed with exit \d+, not the expected/.test(last)
      ? "OFF-CODE"
      : "MISSED";
  }
  return "REFUSED";
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
  const offCode = [];
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
      const rest = argv(gate.args);
      if (rest === null) {
        lines.push(`  REFUSED  ${label}`);
        refused.push(
          `${label}: its args hold a quote, which a probe cannot pass as CI's shell would`,
        );
        continue;
      }
      const command = ["npm", "run", "--silent", gate.script, ...rest];
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
        // mutate runs the gate with inherited stdio, so the gate's output,
        // twice over, lands here: the buffer is sized for the chattiest gate.
        { cwd: join(root, "barwise"), encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
      );
      const output = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim().split("\n");
      const last = output.filter((l) => l.startsWith("mutate:")).at(-1)
        ?? `mutate printed no verdict (${
          run.error?.message ?? run.signal ?? `exit ${run.status}`
        })`;
      // The gate's own last lines, so a reading that is not CAUGHT says
      // what the gate printed without a rerun by hand.
      const tail = output.filter((l) => !l.startsWith("mutate:")).slice(-8)
        .map((l) => `      | ${l}`).join("\n");
      const v = verdict(run.status, last);
      lines.push(`  ${v.padEnd(8)} ${label}`);
      if (v === "MISSED") missed.push(`${label}: ${last}\n${tail}`);
      else if (v === "OFF-CODE") offCode.push(`${label}: ${last}\n${tail}`);
      else if (v === "REFUSED") refused.push(`${label}: ${last}\n${tail}`);
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
  if (missed.length > 0 || offCode.length > 0) {
    if (missed.length > 0) {
      say(
        `FAIL -- ${missed.length} declared gate(s) did not go red on their decision's violation:`,
      );
      for (const m of missed) console.error(`  ${m}`);
    }
    if (offCode.length > 0) {
      say(
        `FAIL -- ${offCode.length} declared gate(s) went red with a code other than 1,`
          + " so the refusal contract misreads them (not a proxy):",
      );
      for (const m of offCode) console.error(`  ${m}`);
    }
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
