#!/usr/bin/env node
/**
 * check:adr-model -- the ADR governance schema as a second judge
 * (docs/specs/adr-conformance-model.spec.md, WS3).
 *
 * The five fact rules of check:architecture's declaration pass are stated
 * as subset constraints in barwise/docs/adr/governance.orm.yaml. This check
 * fills that schema's populations from the repository, lets
 * @barwise/core's population validation judge them, runs the code judge
 * (judgeDeclarations) on the same tree, and compares the two.
 *
 * They are compared as multisets of (rule, ADR, entry position, key). Core
 * reports a subset violation once per distinct value, so each is expanded
 * to the entries that carry it, and an id an entry lists twice counts
 * twice, as the code judge reports it. A model finding the code judge
 * did not make is "shadowed", and no disagreement, when the code judge
 * reported a lower-ranked rule of the same chain on the same entry and key:
 * an untracked issue is also not open, but the code judge stops at the
 * first. Refusals are compared for the inputs the model reads.
 *
 * Exit codes (docs/adr/gate-refusal-contract.md), while the model is a
 * second judge:
 *   0  the two judges agree (whatever either found: check:architecture
 *      reports the findings)
 *   1  they disagree, named
 *   2  the model could not answer (core not built or not loadable, the
 *      schema or population would not load, a RULES constraint is deontic,
 *      an error or message it cannot classify), without comparing; or a
 *      reader refusal on either side
 *
 * Usage: node scripts/check-adr-model.mjs [--root <repo>] [--core <path>]
 * --core names core's built entry point (default
 * barwise/packages/core/dist/index.js), so a test can make the import fail.
 */
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function refuse(message) {
  console.error(`check:adr-model: cannot answer: ${message}`);
  process.exit(2);
}

// The gates' one flag parser: a flag given without a value refuses rather
// than falling back to the live repository or the default build.
const here = dirname(fileURLToPath(import.meta.url));
let root, corePath;
try {
  const { opt } = await import("./lib/args.mjs");
  root = resolve(opt("--root") ?? join(here, "..", ".."));
  corePath = opt("--core") ?? join(root, "barwise", "packages", "core", "dist", "index.js");
} catch (err) {
  refuse(err instanceof Error ? err.message : String(err));
}

// Every import is loaded here, in one place that can refuse. The CI step
// runs under !cancelled(), so after a failed `npm ci` too, when `yaml`
// may be missing: an import that throws must be exit 2, never Node's
// uncaught-error exit 1, which reads as a disagreement.
let core, YAML, facts, judge, population, section, readFileSync;
try {
  ({ readFileSync } = await import("node:fs"));
  core = await import(pathToFileURL(isAbsolute(corePath) ? corePath : resolve(corePath)).href);
  YAML = (await import("yaml")).default;
  facts = await import("./lib/adr-facts.mjs");
  judge = await import("./lib/adr-judge.mjs");
  population = await import("./lib/adr-population.mjs");
  section = await import("./lib/architecture-section.mjs");
} catch (err) {
  refuse(
    `a dependency would not load (${err instanceof Error ? err.message : String(err)}).\n`
      + "  @barwise/core must be built first: npm run build:core.",
  );
}
const { RULES, judgeDeclarations, needsWorkflow } = judge;
const { compareJudges, factStrings, modelJudge } = population;
const { createGovernanceReader } = facts;
const { isAdr, readFiles, trackedPaths } = section;

const SCHEMA = join(root, "barwise", "docs", "adr", "governance.orm.yaml");

async function main() {
  const adrs = readFiles(root, trackedPaths(root).filter(isAdr));
  const schemaText = readFileSync(SCHEMA, "utf8");
  if (adrs.length === 0) refuse(`no ADR under ${join(root, "barwise", "docs", "adr")}`);

  // The code judge, on a reader of its own, built as check:architecture
  // builds it; the model, on another: each reader records an unreadable
  // input's refusal once, into the list it was built with.
  const codeRefusals = [];
  const code = judgeDeclarations(
    adrs,
    await createGovernanceReader(root, {
      needsWorkflow: needsWorkflow(adrs),
      refusals: codeRefusals,
    }),
    codeRefusals,
  );
  const modelRefusals = [];
  const model = modelJudge(
    adrs,
    await createGovernanceReader(root, { needsWorkflow: false, refusals: modelRefusals }),
    { core, YAML, schemaText, rules: RULES },
  );

  if (model.self.length > 0) {
    console.error("check:adr-model: the model could not answer, so nothing was compared:");
    for (const s of model.self) console.error(`  ${s}`);
    process.exit(2);
  }
  const codeFacts = factStrings(code.facts);
  const disagreements = compareJudges({
    codeFacts,
    codeRefusals,
    modelFindings: model.findings,
    modelRefusals,
    rules: RULES,
  });
  if (disagreements.length > 0) {
    console.error(
      `check:adr-model: FAIL -- the code judge and the model disagree on ${disagreements.length}`
        + " finding(s) (rule|ADR|entry position|key):",
    );
    for (const d of disagreements) console.error(`  ${d}`);
    console.error(
      "Each disagreement is a bug in one of the two judges; fix it, and add its input as a case in"
        + " scripts/tests/adr-model.test.mjs (docs/specs/adr-conformance-model.spec.md, WS3).",
    );
    process.exit(1);
  }
  if (codeRefusals.length > 0 || modelRefusals.length > 0) {
    console.error("check:adr-model: cannot answer for an input a judge could not read:");
    for (const r of new Set([...codeRefusals, ...modelRefusals])) console.error(`  ${r}`);
    process.exit(2);
  }
  console.log(
    `check:adr-model: the code judge and the model agree on ${codeFacts.length} fact-rule`
      + ` finding(s) over ${adrs.length} ADRs (${RULES.map((r) => r.id).join(", ")}). OK`,
  );
}

// Anything thrown past the imports is an answer this check could not give:
// exit 2, never Node's uncaught-error exit 1, which reads as a disagreement.
try {
  await main();
} catch (err) {
  refuse(`an unexpected error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
}
