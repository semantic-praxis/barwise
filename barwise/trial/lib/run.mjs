#!/usr/bin/env node
/**
 * The trial lane's entry point.
 *
 *   node trial/lib/run.mjs generate [--customer <id>] [--tier <t>]
 *   node trial/lib/run.mjs offline  [--customer <id>] [--tier <t>] [--sprint 1,3] [--no-gate]
 *   node trial/lib/run.mjs keyed    [--customer <id>] [--tier <t>]
 *   node trial/lib/run.mjs list
 *
 * Exit contract (docs/specs/gate-refusal-contract.spec.md): 0 the run
 * completed and the gate passed, 1 the gate found a new or stale
 * finding, 2 the lane could not answer (no bundles, nothing generated,
 * no customers). `offline` runs the deterministic sprints and then the
 * gate; `keyed` runs sprint 2 and is the one that needs a provider key.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { parse, stringify } from "yaml";
import { runGate } from "./gate.mjs";
import { generateCode } from "./generators/code.mjs";
import { generateDbt } from "./generators/dbt.mjs";
import { generateDdl } from "./generators/ddl.mjs";
import { generateNorma } from "./generators/norma.mjs";
import { generateOpenApi } from "./generators/openapi.mjs";
import { scaleModel } from "./generators/scale.mjs";
import { messTranscript } from "./generators/transcript.mjs";
import { generateAvro, generateOwl } from "./generators/unreadable.mjs";
import { readModel, writeModel } from "./model.mjs";
import {
  bundlesPresent,
  generatedDir,
  listCustomerDirs,
  resultsPath,
  SCALE,
  staleBundles,
  TIERS,
  TRIAL_DIR,
} from "./paths.mjs";
import { personaProblems } from "./personas.mjs";
import { mergeResults } from "./results.mjs";
import * as steps from "./steps.mjs";

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

const sha = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 16);

/**
 * A directory's hash is the hash of its file list and contents, walked in
 * sorted order so the result is the same on any filesystem. Directory
 * artifacts used to record the literal string "dir", which made a dbt
 * project or code repo unable to distinguish two different contents --
 * a hash that cannot change is not a content hash.
 */
/**
 * The sprints a run will actually execute. Sprint 4.5 (the late
 * requirement) rides along with sprint 4 and can also be asked for alone.
 * It used to be dispatched only on `includes(4)`, so `--sprint 4.5` passed
 * validation, ran nothing, and left the previous results for the gate to
 * read; and the results keep-filter never counted 4.5 as run, so a 4.5 row
 * from a step since renamed survived forever. Dispatch and keep-filter
 * both read this one set.
 */
export function plannedSprints(sprints) {
  const runs = new Set(sprints);
  if (runs.has(4)) runs.add(4.5);
  return runs;
}

export function hashTree(root) {
  const parts = [];
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, rel);
      else parts.push(`${rel}\u0000${sha(readFileSync(full))}`);
    }
  };
  walk(root, "");
  return sha(parts.join("\n"));
}

export function generate(customer, tier) {
  const gen = generatedDir(customer.dir, tier);
  rmSync(gen, { recursive: true, force: true });
  mkdirSync(gen, { recursive: true });
  const kernel = readModel(customer.kernelPath);
  const factor = customer.scale?.[tier] ?? SCALE[tier];
  const scaled = scaleModel(kernel, factor);
  writeModel(join(gen, "scaled.orm.yaml"), scaled);
  const hashes = { "scaled.orm.yaml": sha(readFileSync(join(gen, "scaled.orm.yaml"))) };
  for (const art of customer.artifacts ?? []) {
    const skin = art.skin ? parse(readFileSync(join(customer.dir, art.skin), "utf8")) ?? {} : {};
    const k = art.tiers?.[tier] ?? 1;
    const opts = { factor: k, seed: customer.seed ?? 7, artifactId: art.id };
    let manifest;
    let path;
    switch (art.generator) {
      case "ddl": {
        const r = generateDdl(kernel, { dialect: art.dialect, ...skin }, opts);
        path = `${art.id}.sql`;
        writeFileSync(join(gen, path), r.text);
        manifest = r.manifest;
        break;
      }
      case "openapi": {
        const r = generateOpenApi(kernel, skin, opts);
        path = `${art.id}.openapi.json`;
        writeFileSync(join(gen, path), r.text);
        manifest = r.manifest;
        break;
      }
      case "dbt": {
        path = `${art.id}-project`;
        manifest = generateDbt(kernel, skin, join(gen, path), opts).manifest;
        break;
      }
      case "code": {
        path = `${art.id}-repo`;
        manifest = generateCode(kernel, skin, join(gen, path), opts).manifest;
        break;
      }
      case "norma": {
        const r = generateNorma(kernel, skin, opts);
        path = `${art.id}.orm`;
        writeFileSync(join(gen, path), r.text);
        manifest = r.manifest;
        break;
      }
      case "owl": {
        const r = generateOwl(kernel, {
          ...skin,
          size_mb: tier === "enterprise" ? skin.size_mb_enterprise ?? 0 : 0,
        }, opts);
        path = `${art.id}.owl`;
        writeFileSync(join(gen, path), r.text);
        manifest = r.manifest;
        break;
      }
      case "avro": {
        const r = generateAvro(kernel, skin, opts);
        path = `${art.id}.avsc`;
        writeFileSync(join(gen, path), r.text);
        manifest = r.manifest;
        break;
      }
      default:
        throw new Error(
          `${customer.id}: unknown generator ${art.generator} for artifact ${art.id}`,
        );
    }
    manifest.path = path;
    manifest.tier = tier;
    writeFileSync(join(gen, `${art.id}.manifest.json`), JSON.stringify(manifest, null, 2));
    const artifactPath = join(gen, path);
    hashes[path] = !existsSync(artifactPath)
      ? "absent"
      : statSync(artifactPath).isDirectory()
      ? hashTree(artifactPath)
      : sha(readFileSync(artifactPath));
  }
  for (const t of customer.transcripts ?? []) {
    const src = join(customer.dir, t.file);
    if (!existsSync(src)) continue;
    const key = t.key && existsSync(join(customer.dir, t.key))
      ? parse(readFileSync(join(customer.dir, t.key), "utf8"))
      : { seeded: [] };
    const messy = messTranscript(readFileSync(src, "utf8"), key, {
      seed: customer.seed ?? 7,
      tier,
    });
    const name = t.file.slice(t.file.lastIndexOf("/") + 1);
    writeFileSync(join(gen, name), messy.text);
    writeFileSync(join(gen, `${name}.key.yaml`), stringify(messy.key));
    hashes[name] = sha(messy.text);
  }
  writeFileSync(
    join(gen, "manifest.json"),
    JSON.stringify({ customer: customer.id, tier, factor, hashes }, null, 2),
  );
  return hashes;
}

async function offline(customers, tier, sprints, opts) {
  if (!bundlesPresent()) {
    console.error(
      "trial: CLI or MCP bundle missing. Build them first:\n  npm run build && npm run --workspace=@barwise/cli bundle && npm run --workspace=@barwise/mcp bundle",
    );
    process.exit(2);
  }
  const stale = staleBundles();
  if (stale.length) {
    console.error(
      `trial: ${stale.map((s) => s.bundle).join(" and ")} ${
        stale.length > 1 ? "are" : "is"
      } older than ${
        stale[0].newerSource
      }; grading it would grade old code. Rebuild first:\n  npm run build && npm run --workspace=@barwise/cli bundle && npm run --workspace=@barwise/mcp bundle`,
    );
    process.exit(2);
  }
  const runs = plannedSprints(sprints);
  const path = resultsPath(tier);
  const prior = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { tier, results: [] };
  const kept = prior.results.filter((r) =>
    !customers.some((c) => c.id === r.customer) || !runs.has(r.sprint)
  );
  const fresh = [];
  for (const customer of customers) {
    const gen = generatedDir(customer.dir, tier);
    if (!existsSync(join(gen, "manifest.json"))) {
      console.error(
        `trial: ${customer.id} has no generated ${tier} tier. Run: npm run trial:generate -- --customer ${customer.id} --tier ${tier}`,
      );
      process.exit(2);
    }
    const record = (r) => {
      const row = { customer: customer.id, tier, ...r };
      fresh.push(row);
      const tag = row.status === "pass"
        ? "PASS"
        : row.status === "refused"
        ? "REFUSED"
        : row.status === "fail"
        ? `FAIL ${row.severity ?? ""}`
        : "N/A";
      console.log(
        `  ${customer.id} ${tier} s${row.sprint} ${row.step.padEnd(36)} ${tag.padEnd(9)} ${
          String(row.ms ?? "").padStart(7)
        }ms  ${row.detail ?? ""}`.slice(0, 220),
      );
    };
    console.log(`\n== ${customer.id} ${customer.name} (${tier}) ==`);
    if (runs.has(1)) {
      steps.sprint1Brownfield(customer, tier, record);
      steps.sprint1ModelOps(customer, tier, record);
    }
    if (runs.has(2)) steps.sprint2Elicitation(customer, tier, record);
    if (runs.has(3)) steps.sprint3Governance(customer, tier, record);
    if (runs.has(4)) steps.sprint4Downstream(customer, tier, record);
    if (runs.has(4.5)) steps.sprint4bLateRequirement(customer, tier, record);
    if (runs.has(5)) steps.sprint5ChangeStorm(customer, tier, record);
    if (runs.has(6)) await steps.sprint6Surfaces(customer, tier, record);
  }
  const results = mergeResults(kept, fresh);
  mkdirSync(join(TRIAL_DIR, "results"), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ tier, generatedAt: new Date().toISOString(), results }, null, 2),
  );
  summarize(fresh);
  if (opts.gate === false) return 0;
  return runGate({ tier, write: !!opts.write });
}

function summarize(rows) {
  const by = {};
  for (const r of rows) {
    const k = r.status === "fail" ? `fail ${r.severity ?? "?"}` : r.status;
    by[k] = (by[k] ?? 0) + 1;
  }
  // Say which population this is. It counts the rows THIS invocation ran,
  // while the gate line printed under it counts the whole results file --
  // equal on a full run, different on --customer or --sprint, and nothing
  // said so.
  console.log(
    "\nSummary (this run):",
    Object.entries(by).map(([k, v]) => `${k}=${v}`).join("  "),
  );
}

async function main() {
  const a = args(process.argv.slice(2));
  const cmd = a._[0] ?? "offline";
  const tier = a.tier ?? "small";
  if (!TIERS.includes(tier)) {
    console.error(`trial: unknown tier ${tier}; one of ${TIERS.join(", ")}`);
    process.exit(2);
  }
  const dirs = listCustomerDirs(a.customer);
  if (dirs.length === 0) {
    console.error(
      `trial: no customer packages${a.customer ? ` matching ${a.customer}` : ""} under ${
        relative(process.cwd(), TRIAL_DIR)
      }/customers`,
    );
    process.exit(2);
  }
  const customers = dirs.filter((d) => existsSync(join(d, "customer.yaml"))).map(
    steps.loadCustomer,
  );
  if (customers.length === 0) {
    console.error("trial: no customer.yaml in any package directory; nothing to run");
    process.exit(2);
  }
  // A persona declaration the runner cannot honour is an authoring
  // defect: grading anyway would fall back to a rule nobody wrote down,
  // which is how eleven rows came to rest on one (barwise-uzn).
  const problems = customers.flatMap((c) =>
    personaProblems(c, (persona) => {
      const rubric = join(c.dir, persona.acceptance ?? "");
      return persona.acceptance && existsSync(rubric)
        ? parse(readFileSync(rubric, "utf8")).checks ?? []
        : [];
    })
  );
  if (problems.length) {
    for (const m of problems) console.error(`trial: ${m}`);
    console.error(
      `trial: ${problems.length} persona declaration problem(s); see trial/AUTHORING.md`,
    );
    process.exit(2);
  }
  if (cmd === "list") {
    for (const c of customers) {
      console.log(
        `${c.id}  ${c.name}  artifacts=${(c.artifacts ?? []).length} personas=${
          (c.personas ?? []).length
        } stressors=${(c.stressors ?? []).join(",")}`,
      );
    }
    return 0;
  }
  if (cmd === "generate") {
    for (const c of customers) {
      const hashes = generate(c, tier);
      console.log(`${c.id} ${tier}: ${Object.keys(hashes).length} artifact(s) generated`);
    }
    return 0;
  }
  const KNOWN_SPRINTS = [1, 2, 3, 4, 4.5, 5, 6];
  let sprints;
  if (a.sprint) {
    const asked = String(a.sprint).split(",").map((t) => t.trim());
    const parsed = asked.map(Number);
    const bad = asked.filter((_, i) => !KNOWN_SPRINTS.includes(parsed[i]));
    if (bad.length) {
      // Silently running no sprint at all left the previous results in place
      // for the gate to read, so a typo looked like a clean run.
      console.error(
        `trial: unknown sprint(s) ${bad.join(", ")}; known sprints are ${KNOWN_SPRINTS.join(", ")}`,
      );
      return 2;
    }
    sprints = parsed;
  } else {
    sprints = cmd === "keyed" ? [2] : [1, 3, 4, 5, 6];
  }
  if (cmd === "offline" || cmd === "keyed") {
    return offline(customers, tier, sprints, { gate: a["no-gate"] ? false : true, write: a.write });
  }
  console.error(`trial: unknown command ${cmd}`);
  return 2;
}

// Guarded the way gate.mjs already guards its own entry point. Without
// this, importing anything from this module -- a helper, for a test --
// ran the whole trial as a side effect of the import.
if (process.argv[1] && process.argv[1].endsWith("run.mjs")) {
  main().then((code) => process.exit(code ?? 0), (e) => {
    console.error(e);
    process.exit(2);
  });
}
