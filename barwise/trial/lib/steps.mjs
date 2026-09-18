/**
 * The six sprints, as functions over one customer at one tier. Each
 * step records one outcome; nothing here decides pass or fail, the
 * oracles in ./oracles/grade.mjs do, so a step is a recipe (which
 * command, over which artifact, graded by which oracle) and the tests
 * can exercise the oracles without a bundle.
 *
 * The sprints are the same for every customer by design. A per-customer
 * journey file would be twelve copies of one list, which is the
 * must-agree copy CLAUDE.md forbids; a customer varies by its package
 * (artifacts, contexts, history, personas), never by its journey.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { runCli } from "./exec.mjs";
import { applyChange, buildHistoryRepo } from "./generators/history.mjs";
import { withMcp } from "./mcp.mjs";
import { byName, factTypes, objectTypes, readModel, writeModel } from "./model.mjs";
import * as grade from "./oracles/grade.mjs";
import {
  BARWISE_DIR,
  CLI_BUNDLE,
  generatedDir,
  LOSS_SETS_DIR,
  MCP_BUNDLE,
  TRIAL_DIR,
} from "./paths.mjs";

export function loadCustomer(dir) {
  const customer = parse(readFileSync(join(dir, "customer.yaml"), "utf8"));
  customer.dir = dir;
  customer.kernelPath = join(dir, "kernel.orm.yaml");
  return customer;
}

function modelSummaryOf(path) {
  if (!existsSync(path)) return null;
  try {
    const doc = readModel(path);
    return {
      objectTypes: objectTypes(doc).length,
      factTypes: factTypes(doc).length,
      names: objectTypes(doc).map((o) => o.name),
    };
  } catch (e) {
    return { objectTypes: 0, factTypes: 0, names: [], unreadable: e.message };
  }
}

function lossSet(format) {
  const p = join(LOSS_SETS_DIR, `${format}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : { allowed: [] };
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const importCommand = (importer, path, dialect) => {
  switch (importer) {
    case "ddl":
    case "openapi":
    case "norma":
      return ["import", "model", path, "--format", importer];
    case "sql":
      return ["import", "sql", path, ...(dialect ? ["--dialect", dialect] : [])];
    case "dbt":
      return ["import", "dbt", path];
    case "typescript":
    case "java":
    case "kotlin":
      return ["import", importer, path];
    default:
      // Formats barwise does not read: the step still runs, through the
      // generic entry point, so the refusal is what gets graded.
      return ["import", "model", path, "--format", importer];
  }
};

const exporterFor = { ddl: "ddl", sql: "ddl", openapi: "openapi", dbt: "dbt", norma: "norma" };
const reimporterFor = { ddl: "ddl", sql: "sql", openapi: "openapi", dbt: "dbt", norma: "norma" };

/**
 * Sprint 1: every legacy artifact through its importer; the produced
 * model validated; then export-reimport for a round trip.
 */
export function sprint1Brownfield(customer, tier, record) {
  const gen = generatedDir(customer.dir, tier);
  const budget = customer.budgets?.[tier] ?? 600_000;
  for (const art of customer.artifacts ?? []) {
    const manifestPath = join(gen, `${art.id}.manifest.json`);
    if (!existsSync(manifestPath)) {
      record({
        sprint: 1,
        step: `import:${art.id}`,
        status: "could_not_answer",
        detail: `no generated artifact; run trial:generate`,
      });
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const input = join(gen, manifest.path);
    const out = join(gen, `${art.id}.imported.orm.yaml`);
    rmSync(out, { force: true });
    const res = runCli([...importCommand(art.importer, input, art.dialect), "--output", out], {
      timeoutMs: budget,
      cwd: gen,
    });
    const summary = modelSummaryOf(out);
    const outcome = grade.gradeImport(res, manifest, art.expect ?? "import", summary);
    record({
      sprint: 1,
      step: `import:${art.id}`,
      artifact: art.id,
      importer: art.importer,
      dialect: art.dialect,
      ...outcome,
      ms: res.ms,
      exit: res.exit,
      stderr: tail(res.stderr),
    });
    if (!summary || summary.objectTypes === 0) continue;

    const v = runCli(["validate", out, "--format", "json"], { timeoutMs: budget });
    record({
      sprint: 1,
      step: `validate-imported:${art.id}`,
      artifact: art.id,
      importer: art.importer,
      ...grade.gradeProducedModelValidation(v, parseJson(v.stdout) ?? []),
      ms: v.ms,
      exit: v.exit,
    });

    const exporter = exporterFor[art.importer];
    const reimporter = reimporterFor[art.importer];
    if (!exporter) continue;
    const exported = join(
      gen,
      `${art.id}.roundtrip.${
        exporter === "dbt"
          ? "dbt"
          : exporter === "openapi"
          ? "json"
          : exporter === "norma"
          ? "orm"
          : "sql"
      }`,
    );
    rmSync(exported, { force: true, recursive: true });
    const dialectArgs = exporter === "ddl" && art.dialect && SUPPORTED_DIALECTS.has(art.dialect)
      ? ["--dialect", art.dialect]
      : [];
    const e = runCli(["export", out, "--format", exporter, "--output", exported, ...dialectArgs], {
      timeoutMs: budget,
    });
    const eg = grade.gradeCommand(e, { budgetMs: budget });
    record({
      sprint: 1,
      step: `roundtrip-export:${art.id}`,
      artifact: art.id,
      importer: art.importer,
      format: exporter,
      ...eg,
      ms: e.ms,
      exit: e.exit,
      stderr: tail(e.stderr),
    });
    if (eg.status !== "pass") continue;
    const back = join(gen, `${art.id}.roundtrip.orm.yaml`);
    rmSync(back, { force: true });
    const r = runCli([
      ...importCommand(
        reimporter,
        exported,
        SUPPORTED_DIALECTS.has(art.dialect) ? art.dialect : undefined,
      ),
      "--output",
      back,
    ], { timeoutMs: budget, cwd: gen });
    const rg = grade.gradeCommand(r, { budgetMs: budget });
    if (rg.status !== "pass" || !existsSync(back)) {
      record({
        sprint: 1,
        step: `roundtrip-reimport:${art.id}`,
        artifact: art.id,
        importer: art.importer,
        ...rg,
        ms: r.ms,
        exit: r.exit,
        stderr: tail(r.stderr),
      });
      continue;
    }
    const d = runCli(["diff", out, back, "--format", "json"], { timeoutMs: budget });
    const diff = parseJson(d.stdout);
    const outcome2 = diff
      ? grade.gradeRoundTrip(diff, lossSet(exporter))
      : grade.gradeCommand(d, { budgetMs: budget });
    record({
      sprint: 1,
      step: `roundtrip-diff:${art.id}`,
      artifact: art.id,
      importer: art.importer,
      format: exporter,
      ...outcome2,
      ms: d.ms,
      exit: d.exit,
    });
  }
}

const SUPPORTED_DIALECTS = new Set([
  "ansi",
  "snowflake",
  "bigquery",
  "postgres",
  "mysql",
  "redshift",
  "databricks",
]);

/** Sprint 1b: the model itself, at tier scale, through every read-only command. */
export function sprint1ModelOps(customer, tier, record) {
  const gen = generatedDir(customer.dir, tier);
  const budget = customer.budgets?.[tier] ?? 600_000;
  const scaled = join(gen, "scaled.orm.yaml");
  if (!existsSync(scaled)) {
    record({
      sprint: 1,
      step: "scaled-model",
      status: "could_not_answer",
      detail: "no scaled model; run trial:generate",
    });
    return;
  }
  const summary = modelSummaryOf(scaled);
  const commands = [
    ["validate", ["validate", scaled]],
    ["verbalize", ["verbalize", scaled]],
    ["describe", ["describe", scaled]],
    ["schema", ["schema", scaled]],
    ["diagram", ["diagram", scaled, "--output", join(gen, "scaled.svg")]],
    ["export-ddl", ["export", scaled, "--format", "ddl", "--output", join(gen, "scaled.sql")]],
    ["export-openapi", [
      "export",
      scaled,
      "--format",
      "openapi",
      "--output",
      join(gen, "scaled.openapi.json"),
    ]],
    ["export-avro", ["export", scaled, "--format", "avro", "--output", join(gen, "scaled.avsc")]],
    ["export-norma", ["export", scaled, "--format", "norma", "--output", join(gen, "scaled.orm")]],
    ["export-dbt", ["export", scaled, "--format", "dbt", "--output", join(gen, "scaled-dbt")]],
    ["query-anchors", ["query", scaled, "anchors"]],
  ];
  for (const [name, args] of commands) {
    const res = runCli(args, { timeoutMs: budget });
    const outcome = grade.gradeCommand(res, { budgetMs: budget });
    record({
      sprint: 1,
      step: `model:${name}`,
      scale: summary?.objectTypes,
      ...outcome,
      ms: res.ms,
      exit: res.exit,
      stderr: tail(res.stderr),
    });
  }
  // Round trip of the scaled model through every exporter that has an importer.
  for (
    const [fmt, file, importer] of [
      ["ddl", "scaled.sql", "ddl"],
      ["openapi", "scaled.openapi.json", "openapi"],
      ["norma", "scaled.orm", "norma"],
      ["dbt", "scaled-dbt", "dbt"],
    ]
  ) {
    const exported = join(gen, file);
    if (!existsSync(exported)) continue;
    const back = join(gen, `scaled.${fmt}.back.orm.yaml`);
    rmSync(back, { force: true });
    const r = runCli([...importCommand(importer, exported), "--output", back], {
      timeoutMs: budget,
      cwd: gen,
    });
    const rg = grade.gradeCommand(r, { budgetMs: budget });
    if (rg.status !== "pass" || !existsSync(back)) {
      record({
        sprint: 1,
        step: `model-roundtrip:${fmt}`,
        ...rg,
        ms: r.ms,
        exit: r.exit,
        stderr: tail(r.stderr),
      });
      continue;
    }
    const d = runCli(["diff", scaled, back, "--format", "json"], { timeoutMs: budget });
    const diff = parseJson(d.stdout);
    record({
      sprint: 1,
      step: `model-roundtrip:${fmt}`,
      ...(diff ? grade.gradeRoundTrip(diff, lossSet(fmt)) : grade.gradeCommand(d)),
      ms: d.ms,
      exit: d.exit,
    });
  }
}

/** Sprint 2: transcripts. Keyed; without a provider the step says so. */
export function sprint2Elicitation(customer, tier, record) {
  const gen = generatedDir(customer.dir, tier);
  const hasKey =
    !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.OLLAMA_HOST);
  for (const t of customer.transcripts ?? []) {
    const messy = join(gen, `${basename(t.file)}`);
    if (!existsSync(messy)) {
      record({
        sprint: 2,
        step: `transcript:${basename(t.file)}`,
        status: "could_not_answer",
        detail: "no messed transcript; run trial:generate",
      });
      continue;
    }
    if (!hasKey) {
      record({
        sprint: 2,
        step: `transcript:${basename(t.file)}`,
        status: "could_not_answer",
        detail:
          "keyed lane: no provider key in the environment (ANTHROPIC_API_KEY, OPENAI_API_KEY or OLLAMA_HOST)",
      });
      continue;
    }
    const out = join(gen, `${basename(t.file)}.orm.yaml`);
    const res = runCli(["import", "transcript", messy, "--output", out], {
      timeoutMs: customer.budgets?.[tier] ?? 600_000,
    });
    record({
      sprint: 2,
      step: `transcript:${basename(t.file)}`,
      ...grade.gradeCommand(res),
      ms: res.ms,
      exit: res.exit,
      stderr: tail(res.stderr),
    });
  }
}

/** Sprint 3: split the kernel into its bounded contexts and check nothing fell out. */
export function sprint3Governance(customer, tier, record) {
  const gen = generatedDir(customer.dir, tier);
  const budget = customer.budgets?.[tier] ?? 600_000;
  const model = tier === "small" ? customer.kernelPath : join(gen, "scaled.orm.yaml");
  if (!customer.contexts || !existsSync(model)) {
    record({
      sprint: 3,
      step: "split",
      status: "could_not_answer",
      detail: "no contexts declared or no model",
    });
    return;
  }
  const doc = readModel(model);
  const names = objectTypes(doc).filter((o) => o.kind === "entity").map((o) => o.name);
  const config = { projectName: `${customer.name} (${tier})`, domains: {} };
  for (const [ctx, list] of Object.entries(customer.contexts)) {
    config.domains[ctx] = names.filter((n) =>
      list.some((base) =>
        n === base || (tier !== "small" && n.startsWith(base) && /^\d+$/.test(n.slice(base.length)))
      )
    );
  }
  const cfgPath = join(gen, "split.yaml");
  writeFileSync(cfgPath, stringify(config));
  const outDir = join(gen, "project");
  rmSync(outDir, { recursive: true, force: true });
  const res = runCli(["project", "split", model, "--config", cfgPath, "--out", outDir], {
    timeoutMs: budget,
  });
  const g = grade.gradeCommand(res, { budgetMs: budget });
  if (g.status !== "pass") {
    record({
      sprint: 3,
      step: "split",
      ...g,
      ms: res.ms,
      exit: res.exit,
      stderr: tail(res.stderr),
    });
    return;
  }
  const domainsDir = join(outDir, "domains");
  const domainNames = {};
  for (const f of existsSync(domainsDir) ? readdirSync(domainsDir) : []) {
    const d = readModel(join(domainsDir, f));
    domainNames[f] = objectTypes(d).map((o) => o.name);
  }
  const all = objectTypes(doc).map((o) => o.name);
  record({
    sprint: 3,
    step: "split",
    ...grade.gradeSplit(all, domainNames, res.stderr + res.stdout),
    ms: res.ms,
    exit: res.exit,
    stderr: tail(res.stderr),
  });
  const manifest = readdirSync(outDir).find((f) => f.endsWith(".orm-project.yaml"));
  if (!manifest) return;
  const projectPath = join(outDir, manifest);
  for (
    const [name, args] of [
      ["validate-project", ["validate", projectPath]],
      ["describe-project", ["describe", projectPath]],
      ["diagram-project", ["diagram", projectPath, "--output", join(gen, "project-diagrams")]],
      ["export-project", [
        "export",
        projectPath,
        "--format",
        "ddl",
        "--output",
        join(gen, "project-ddl"),
      ]],
    ]
  ) {
    const r = runCli(args, { timeoutMs: budget });
    record({
      sprint: 3,
      step: name,
      ...grade.gradeCommand(r, { budgetMs: budget }),
      ms: r.ms,
      exit: r.exit,
      stderr: tail(r.stderr),
    });
  }
  const first = Object.values(config.domains).flat();
  if (first.length >= 2) {
    const q = runCli(["query", model, "path", first[0], first[first.length - 1]], {
      timeoutMs: budget,
    });
    record({
      sprint: 3,
      step: "query-path",
      ...grade.gradeCommand(q, { budgetMs: budget, allowNonZero: true }),
      ms: q.ms,
      exit: q.exit,
      stderr: tail(q.stderr),
    });
  }
}

/** Sprint 4: exports the customer's downstream tools must accept. */
export function sprint4Downstream(customer, tier, record) {
  const gen = generatedDir(customer.dir, tier);
  const budget = customer.budgets?.[tier] ?? 600_000;
  const model = tier === "small" ? customer.kernelPath : join(gen, "scaled.orm.yaml");
  if (!existsSync(model)) return;
  const dialects = new Set([
    "ansi",
    ...(customer.artifacts ?? []).map((a) => a.dialect).filter(Boolean),
  ]);
  for (const dialect of dialects) {
    const out = join(gen, `downstream.${dialect}.sql`);
    rmSync(out, { force: true });
    const res = runCli(
      ["export", model, "--format", "ddl", "--dialect", dialect, "--output", out],
      { timeoutMs: budget },
    );
    if (!SUPPORTED_DIALECTS.has(dialect)) {
      const g = res.exit !== 0 && /supported|unknown|dialect/i.test(res.stderr)
        ? { status: "refused", detail: grade.firstLine(res.stderr) }
        : res.exit !== 0
        ? {
          status: "fail",
          severity: "S3",
          detail: `exit ${res.exit}: ${grade.firstLine(res.stderr)}`,
        }
        : {
          status: "fail",
          severity: "S1",
          detail:
            `export accepted --dialect ${dialect}, which barwise does not implement, and wrote a file`,
        };
      record({
        sprint: 4,
        step: `export-ddl:${dialect}`,
        dialect,
        ...g,
        ms: res.ms,
        exit: res.exit,
        stderr: tail(res.stderr),
      });
      continue;
    }
    const g = grade.gradeCommand(res, { budgetMs: budget });
    record({
      sprint: 4,
      step: `export-ddl:${dialect}`,
      dialect,
      ...g,
      ms: res.ms,
      exit: res.exit,
      stderr: tail(res.stderr),
    });
    if (g.status !== "pass") continue;
    // Read the export back with barwise's own SQL importer. This used to
    // hand the file to a sqlglot sidecar the lane carried itself; that
    // was scaffolding standing in for a product feature, and a trial
    // that writes its own parser is no longer exercising the product.
    const back = join(gen, `downstream.${dialect}.back.orm.yaml`);
    rmSync(back, { force: true });
    const r = runCli(["import", "sql", out, "--dialect", dialect, "--output", back], {
      timeoutMs: budget,
      cwd: gen,
    });
    record({
      sprint: 4,
      step: `read-back-ddl:${dialect}`,
      dialect,
      importer: "sql",
      ...grade.gradeCommand(r, { budgetMs: budget }),
      ms: r.ms,
      exit: r.exit,
      stderr: tail(r.stderr),
    });
  }
  // Every other format, read back the same way. Avro has no importer, so
  // the step says so rather than the lane inventing one.
  for (
    const [fmt, file, importer] of [
      ["openapi", "downstream.openapi.json", "openapi"],
      ["dbt", "downstream-dbt", "dbt"],
      ["norma", "downstream.orm", "norma"],
      ["avro", "downstream.avsc", null],
    ]
  ) {
    const out = join(gen, file);
    rmSync(out, { force: true, recursive: true });
    const res = runCli(["export", model, "--format", fmt, "--output", out], { timeoutMs: budget });
    const g = grade.gradeCommand(res, { budgetMs: budget });
    record({
      sprint: 4,
      step: `export:${fmt}`,
      format: fmt,
      ...g,
      ms: res.ms,
      exit: res.exit,
      stderr: tail(res.stderr),
    });
    if (g.status !== "pass") continue;
    if (!importer) {
      record({
        sprint: 4,
        step: `read-back:${fmt}`,
        format: fmt,
        status: "could_not_answer",
        detail: "barwise registers no avro importer, so its own export cannot be read back",
      });
      continue;
    }
    const back = join(gen, `downstream.${fmt}.back.orm.yaml`);
    rmSync(back, { force: true });
    const r = runCli([...importCommand(importer, out), "--output", back], {
      timeoutMs: budget,
      cwd: gen,
    });
    const rg = grade.gradeCommand(r, { budgetMs: budget });
    if (rg.status !== "pass" || !existsSync(back)) {
      record({
        sprint: 4,
        step: `read-back:${fmt}`,
        format: fmt,
        importer,
        ...rg,
        ms: r.ms,
        exit: r.exit,
        stderr: tail(r.stderr),
      });
      continue;
    }
    const v = runCli(["validate", back, "--format", "json"], { timeoutMs: budget });
    record({
      sprint: 4,
      step: `read-back:${fmt}`,
      format: fmt,
      importer,
      ...grade.gradeProducedModelValidation(v, parseJson(v.stdout) ?? []),
      ms: v.ms,
      exit: v.exit,
    });
  }
}

/**
 * Sprint 4b: a late-arriving requirement.
 *
 * Nobody ever has all the details in time. The requirement that lands
 * after the model is signed off and the artifacts are generated is the
 * normal case, not the exception, and it is the moment a modelling tool
 * either earns its place or does not: the question is never "can you
 * model this", it is "what downstream is now wrong, and does anything
 * tell me".
 *
 * The step order is the order a real team hits it: export first, so a
 * lineage manifest exists and the artifacts are real; then the
 * requirement lands; then ask barwise what went stale, what depends on
 * the changed element, and whether the personas still accept the model.
 * Every command here already ships. `lineage` in particular is in the
 * capability matrix and was exercised by nothing else in this lane.
 */
export function sprint4bLateRequirement(customer, tier, record) {
  const gen = generatedDir(customer.dir, tier);
  const budget = customer.budgets?.[tier] ?? 600_000;
  const late = customer.lateRequirement;
  if (!late) {
    record({
      sprint: 4.5,
      step: "late-requirement",
      status: "could_not_answer",
      detail: "the customer package declares no lateRequirement",
    });
    return;
  }
  // Work on a copy: the late requirement must not edit the committed kernel.
  const dir = join(gen, "late");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const before = join(dir, "model.orm.yaml");
  const source = tier === "small" ? customer.kernelPath : join(gen, "scaled.orm.yaml");
  if (!existsSync(source)) return;
  writeFileSync(before, readFileSync(source, "utf8"));

  // 1. Export first, so a lineage manifest exists to go stale.
  const ddl = join(dir, "schema.sql");
  const exported = runCli(["export", before, "--format", "ddl", "--output", ddl], {
    timeoutMs: budget,
    cwd: dir,
  });
  record({
    sprint: 4.5,
    step: "late:export-before",
    ...grade.gradeCommand(exported, { budgetMs: budget }),
    ms: exported.ms,
    exit: exported.exit,
    stderr: tail(exported.stderr),
  });

  const fresh = runCli(["lineage", "status", before, "--format", "json"], {
    timeoutMs: budget,
    cwd: dir,
  });
  record({
    sprint: 4.5,
    step: "late:lineage-before",
    ...grade.gradeCommand(fresh, { budgetMs: budget, allowNonZero: true }),
    ms: fresh.ms,
    exit: fresh.exit,
    stderr: tail(fresh.stderr),
  });

  // 2. The requirement lands, as an ordinary edit to the model.
  let applied;
  try {
    applied = applyChange(readModel(before), late.change);
  } catch (e) {
    record({
      sprint: 4.5,
      step: "late:apply",
      status: "could_not_answer",
      detail: `the declared late requirement could not be applied: ${e.message}`,
    });
    return;
  }
  const after = join(dir, "model.orm.yaml");
  writeModel(after, applied.doc);

  const valid = runCli(["validate", after, "--format", "json"], { timeoutMs: budget });
  record({
    sprint: 4.5,
    step: "late:validate",
    ...grade.gradeProducedModelValidation(valid, parseJson(valid.stdout) ?? []),
    ms: valid.ms,
    exit: valid.exit,
  });

  // 3. Does anything tell the team what is now stale?
  const stale = runCli(["lineage", "status", after, "--format", "json"], {
    timeoutMs: budget,
    cwd: dir,
  });
  record({
    sprint: 4.5,
    step: "late:lineage-stale",
    ...grade.gradeStaleness(stale, parseJson(stale.stdout)),
    ms: stale.ms,
    exit: stale.exit,
    stderr: tail(stale.stderr),
  });

  if (late.element) {
    const impact = runCli(
      ["lineage", "impact", after, "--element", late.element, "--format", "json"],
      { timeoutMs: budget, cwd: dir },
    );
    record({
      sprint: 4.5,
      step: "late:impact",
      element: late.element,
      ...grade.gradeCommand(impact, { budgetMs: budget, allowNonZero: true }),
      ms: impact.ms,
      exit: impact.exit,
      stderr: tail(impact.stderr),
    });
  }

  // 4. Is the requirement visible as a change at all?
  const original = join(dir, "before.orm.yaml");
  writeFileSync(original, readFileSync(source, "utf8"));
  const d = runCli(["diff", original, after, "--format", "json"], { timeoutMs: budget });
  const diff = parseJson(d.stdout);
  record({
    sprint: 4.5,
    step: "late:diff",
    change: late.change,
    ...(diff ? grade.gradeHistoryStep(applied.expect, diff) : grade.gradeCommand(d)),
    ms: d.ms,
    exit: d.exit,
  });

  // 5. Re-export, and confirm the requirement reached the artifact.
  const reexport = runCli(["export", after, "--format", "ddl", "--output", ddl], {
    timeoutMs: budget,
    cwd: dir,
  });
  record({
    sprint: 4.5,
    step: "late:export-after",
    ...grade.gradeCommand(reexport, { budgetMs: budget }),
    ms: reexport.ms,
    exit: reexport.exit,
    stderr: tail(reexport.stderr),
  });
  if (reexport.exit === 0 && late.expectInExport) {
    const text = readFileSync(ddl, "utf8");
    const present = text.toLowerCase().includes(String(late.expectInExport).toLowerCase());
    record({
      sprint: 4.5,
      step: "late:reached-artifact",
      status: present ? "pass" : "fail",
      severity: present ? undefined : "S1",
      detail: present
        ? `the re-export carries "${late.expectInExport}"`
        : `the re-export does not mention "${late.expectInExport}", so the late requirement did not reach the artifact`,
    });
  }

  // 6. Do the people who signed off still accept it?
  for (const p of customer.personas ?? []) {
    const rubric = join(customer.dir, p.acceptance);
    if (!existsSync(rubric)) continue;
    const res = runCli(
      [
        "gym",
        "check",
        p.id,
        after,
        "--catalog",
        join(customer.dir, "personas"),
        "--no-state",
        "--format",
        "json",
      ],
      { timeoutMs: budget },
    );
    record({
      sprint: 4.5,
      step: `late:acceptance:${p.id}`,
      persona: p.id,
      ...grade.gradeAcceptance(res, parseJson(res.stdout)),
      ms: res.ms,
      exit: res.exit,
    });
  }
}

/** Sprint 5: the change storm through history and diff. */
export function sprint5ChangeStorm(customer, tier, record) {
  const gen = generatedDir(customer.dir, tier);
  const budget = customer.budgets?.[tier] ?? 600_000;
  const model = tier === "small" ? customer.kernelPath : join(gen, "scaled.orm.yaml");
  if (!customer.history?.length || !existsSync(model)) {
    record({
      sprint: 5,
      step: "history",
      status: "could_not_answer",
      detail: "no history declared or no model",
    });
    return;
  }
  const repoDir = join(gen, "history-repo");
  rmSync(repoDir, { recursive: true, force: true });
  let built;
  try {
    built = buildHistoryRepo(readModel(model), customer.history, repoDir);
  } catch (e) {
    record({
      sprint: 5,
      step: "history",
      status: "could_not_answer",
      detail: `history script could not be applied: ${e.message}`,
    });
    return;
  }
  const h = runCli(["history", built.file, "--limit", String(customer.history.length + 5)], {
    timeoutMs: budget,
    cwd: repoDir,
  });
  record({
    sprint: 5,
    step: "history",
    commits: built.steps.length,
    ...grade.gradeCommand(h, { budgetMs: budget }),
    ms: h.ms,
    exit: h.exit,
    stderr: tail(h.stderr),
  });
  // A large buffer on purpose: the lane must not hit its OWN ENOBUFS
  // before the product does. barwise's history command sets no
  // maxBuffer at all, which is the scale hazard the next step measures.
  const git = (...args) =>
    execFileSync("git", args, { cwd: repoDir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
      .trim();
  const revs = git("rev-list", "--reverse", "HEAD").split("\n");
  for (let i = 1; i < built.steps.length; i++) {
    const a = join(gen, `hist-${i - 1}.orm.yaml`);
    const b = join(gen, `hist-${i}.orm.yaml`);
    writeFileSync(a, git("show", `${revs[i - 1]}:model.orm.yaml`));
    writeFileSync(b, git("show", `${revs[i]}:model.orm.yaml`));
    const d = runCli(["diff", a, b, "--format", "json"], { timeoutMs: budget });
    const diff = parseJson(d.stdout);
    const step = built.steps[i];
    const outcome = diff
      ? grade.gradeHistoryStep(step.expect, diff)
      : grade.gradeCommand(d, { budgetMs: budget });
    record({
      sprint: 5,
      step: `diff:${i}:${step.change.kind}`,
      change: step.change,
      ...outcome,
      ms: d.ms,
      exit: d.exit,
    });
    const m = runCli(["merge", a, b, "--output", join(gen, `hist-merged-${i}.orm.yaml`)], {
      timeoutMs: budget,
    });
    const mg = grade.gradeCommand(m, {
      budgetMs: budget,
      allowNonZero: step.change.kind === "remove_object_type",
    });
    record({
      sprint: 5,
      step: `merge:${i}:${step.change.kind}`,
      ...mg,
      ms: m.ms,
      exit: m.exit,
      stderr: tail(m.stderr),
    });
  }
  // The scale hazard: history over a model whose revisions exceed 1 MiB.
  if (tier !== "small") {
    const size = readFileSync(built.file).length;
    record({
      sprint: 5,
      step: "history-size",
      status: h.exit === 0 ? "pass" : "fail",
      severity: h.exit === 0 ? undefined : "S2",
      detail: `revision size ${size} bytes; history exit ${h.exit}${
        /ENOBUFS|maxBuffer/.test(h.stderr)
          ? " (ENOBUFS: git show output over the subprocess buffer)"
          : ""
      }`,
    });
  }
}

/** Sprint 6: personas accept or reject; MCP and CLI agree; the release bundle works as shipped. */
export async function sprint6Surfaces(customer, tier, record) {
  const budget = customer.budgets?.[tier] ?? 600_000;
  const gen = generatedDir(customer.dir, tier);
  const model = tier === "small" ? customer.kernelPath : join(gen, "scaled.orm.yaml");
  for (const p of customer.personas ?? []) {
    const exercisePath = join(customer.dir, p.acceptance);
    if (!existsSync(exercisePath)) {
      record({
        sprint: 6,
        step: `acceptance:${p.id}`,
        status: "could_not_answer",
        detail: `no rubric at ${p.acceptance}`,
      });
      continue;
    }
    // A persona judges the model barwise produced from their own artifact, not the kernel.
    const own = (customer.artifacts ?? []).find((a) => (p.judges ?? [])[0] === a.id) ?? null;
    const candidates = [["kernel", model]];
    for (const a of customer.artifacts ?? []) {
      const imported = join(gen, `${a.id}.imported.orm.yaml`);
      if (existsSync(imported) && (modelSummaryOf(imported)?.objectTypes ?? 0) > 0) {
        candidates.push([a.id, imported]);
      }
    }
    for (const [label, candidate] of candidates) {
      if (label !== "kernel" && own && own.id !== label) continue;
      const res = runCli([
        "gym",
        "check",
        p.id,
        candidate,
        "--catalog",
        join(customer.dir, "personas"),
        "--no-state",
        "--format",
        "json",
      ], { timeoutMs: budget });
      const report = parseJson(res.stdout);
      const outcome = grade.gradeAcceptance(res, report);
      // The kernel must satisfy its own personas: a failure there is an authoring defect, not a product one.
      record({
        sprint: 6,
        step: `acceptance:${p.id}:${label}`,
        persona: p.id,
        over: label,
        importer: (customer.artifacts ?? []).find((a) => a.id === label)?.importer,
        ...outcome,
        severity: label === "kernel" && outcome.status === "fail" ? "authoring" : outcome.severity,
        ms: res.ms,
        exit: res.exit,
      });
    }
  }
  if (tier === "small") {
    const bundleList = runCli(["gym", "list"], { timeoutMs: budget });
    record({
      sprint: 6,
      step: "release-bundle:gym-list",
      ...grade.gradeCommand(bundleList, { budgetMs: budget }),
      ms: bundleList.ms,
      exit: bundleList.exit,
      stderr: tail(bundleList.stderr),
    });
  }
  if (!existsSync(MCP_BUNDLE) || !existsSync(model)) return;
  try {
    await withMcp(async (mcp) => {
      const pairs = [
        [
          "validate",
          ["validate", model, "--format", "json"],
          "validate_model",
          { source: model },
          (cli, m) =>
            grade.gradeParity(
              JSON.stringify(summarizeValidation(parseJson(cli))),
              JSON.stringify(summarizeValidation(parseJson(m), true)),
              "validate",
            ),
        ],
        ["export-ddl", ["export", model, "--format", "ddl"], "export_model", {
          source: model,
          format: "ddl",
        }, (cli, m) => grade.gradeParity(cli, m, "export ddl")],
        [
          "verbalize",
          ["verbalize", model],
          "verbalize_model",
          { source: model },
          (cli, m) => grade.gradeParity(cli, m, "verbalize"),
        ],
      ];
      for (const [name, args, tool, toolArgs, compare] of pairs) {
        const cli = runCli(args, { timeoutMs: budget });
        const m = await mcp.call(tool, toolArgs);
        const spilled = /mcp-cache|written to|truncated|spilled/i.test(m.text)
          && m.text.length < 4000;
        if (spilled) {
          record({
            sprint: 6,
            step: `parity:${name}`,
            status: "refused",
            detail:
              `MCP result spilled to a cache file (inline limit); parity not comparable inline`,
            ms: m.ms,
          });
          continue;
        }
        record({
          sprint: 6,
          step: `parity:${name}`,
          ...compare(cli.stdout, m.text),
          ms: m.ms,
          exit: cli.exit,
        });
      }
    });
  } catch (e) {
    record({
      sprint: 6,
      step: "parity",
      status: "fail",
      severity: "S2",
      detail: `MCP session failed: ${String(e.message).split("\n")[0]}`,
    });
  }
}

function summarizeValidation(v, fromMcp = false) {
  if (!v) return { unreadable: true };
  const list = fromMcp ? [...(v.errors ?? []), ...(v.warnings ?? [])] : v;
  return {
    errors: (list ?? []).filter((d) => d.severity === "error").length,
    warnings: (list ?? []).filter((d) => d.severity === "warning").length,
  };
}

export function tail(text, n = 6) {
  const lines = String(text ?? "").trim().split("\n");
  return lines.slice(-n).join("\n").slice(0, 1200);
}

function basename(p) {
  return p.slice(p.lastIndexOf("/") + 1);
}
