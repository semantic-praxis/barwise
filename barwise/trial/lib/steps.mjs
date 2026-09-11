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
import { buildHistoryRepo } from "./generators/history.mjs";
import { withMcp } from "./mcp.mjs";
import { byName, factTypes, objectTypes, readModel } from "./model.mjs";
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
    record({
      sprint: 4,
      step: `consume-ddl:${dialect}`,
      dialect,
      ...grade.gradeConsumer(parseDdlWithSqlglot(out, dialect)),
    });
  }
  for (
    const [fmt, file, check] of [
      ["openapi", "downstream.openapi.json", checkOpenApi],
      ["avro", "downstream.avsc", checkAvro],
      ["dbt", "downstream-dbt", checkDbt],
      ["norma", "downstream.orm", checkXml],
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
    record({ sprint: 4, step: `consume:${fmt}`, format: fmt, ...grade.gradeConsumer(check(out)) });
  }
}

function parseDdlWithSqlglot(file, dialect) {
  try {
    const out = execFileSync("uv", [
      "run",
      "--frozen",
      "--only-group",
      "sqlglot",
      "python",
      join(TRIAL_DIR, "consumers", "parse_ddl.py"),
      file,
      dialect,
    ], {
      cwd: BARWISE_DIR,
      encoding: "utf8",
      timeout: 300_000,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(out);
  } catch (e) {
    return { unavailable: `sqlglot consumer could not run: ${String(e.message).split("\n")[0]}` };
  }
}

function checkOpenApi(file) {
  const doc = parseJson(readFileSync(file, "utf8"));
  if (!doc) return { total: 1, failures: [{ error: "not valid JSON" }] };
  const failures = [];
  if (!doc.openapi) failures.push({ error: "no openapi version field" });
  const schemas = doc.components?.schemas ?? {};
  const refs = JSON.stringify(doc).match(/"\$ref":"#\/components\/schemas\/([^"]+)"/g) ?? [];
  for (const r of refs) {
    const name = r.slice(r.lastIndexOf("/") + 1, -1);
    if (!schemas[name]) failures.push({ error: `dangling $ref to ${name}` });
  }
  return {
    total: Object.keys(schemas).length,
    parsed: Object.keys(schemas).length,
    failures: failures.slice(0, 20),
  };
}

function checkAvro(file) {
  // The exporter writes one .avsc per record into a directory; a single file is one schema.
  const files = existsSync(file) && statSync(file).isDirectory()
    ? readdirSync(file).filter((f) => f.endsWith(".avsc")).map((f) => join(file, f))
    : [file];
  const records = [];
  for (const f of files) {
    const doc = parseJson(readFileSync(f, "utf8"));
    if (!doc) {
      return {
        total: files.length,
        failures: [{ error: `${f.slice(f.lastIndexOf("/") + 1)} is not valid JSON` }],
      };
    }
    records.push(...(Array.isArray(doc) ? doc : [doc]));
  }
  const failures = [];
  const defined = new Set();
  for (const r of records) {
    if (r.type !== "record" || !r.name || !Array.isArray(r.fields)) {
      failures.push({ error: `record without name/fields: ${JSON.stringify(r).slice(0, 80)}` });
    }
    if (defined.has(r.name)) failures.push({ error: `duplicate record name ${r.name}` });
    defined.add(r.name);
    for (const f of r.fields ?? []) {
      if (!f.name || f.type === undefined) {
        failures.push({ error: `field without name/type in ${r.name}` });
      }
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name ?? "")) {
        failures.push({ error: `field name not an Avro identifier: ${f.name} in ${r.name}` });
      }
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(r.name ?? "")) {
      failures.push({ error: `record name not an Avro identifier: ${r.name}` });
    }
  }
  return {
    total: records.length,
    parsed: records.length - failures.length,
    failures: failures.slice(0, 20),
  };
}

function checkDbt(dir) {
  const failures = [];
  let total = 0;
  const walk = (d) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.ya?ml$/.test(f.name)) {
        total++;
        try {
          parse(readFileSync(p, "utf8"));
        } catch (e) {
          failures.push({ error: `${f.name}: ${e.message.split("\n")[0]}` });
        }
      } else if (f.name.endsWith(".sql")) total++;
    }
  };
  if (existsSync(dir)) walk(dir);
  if (total === 0) failures.push({ error: "no files written" });
  return { total, parsed: total - failures.length, failures };
}

function checkXml(file) {
  const text = readFileSync(file, "utf8");
  const failures = [];
  if (!text.trim().startsWith("<?xml")) failures.push({ error: "no XML declaration" });
  const open = (text.match(/<orm:[A-Za-z]+[\s>]/g) ?? []).length;
  const close = (text.match(/<\/orm:[A-Za-z]+>/g) ?? []).length + (text.match(/\/>/g) ?? []).length;
  if (Math.abs(open - close) > 2) failures.push({ error: `tag balance off by ${open - close}` });
  return { total: 1, parsed: failures.length ? 0 : 1, failures };
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
