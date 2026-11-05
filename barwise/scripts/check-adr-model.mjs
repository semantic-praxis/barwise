#!/usr/bin/env node
/**
 * check:adr-model -- the ADR governance schema as the judge of five rules
 * (docs/specs/adr-conformance-model.spec.md, WS4).
 *
 * Every entry in an ADR's Enforced-by: header lists ids its ADR has; every
 * decision has an entry; a script an entry names is in package.json; an
 * issue a none entry cites is in the tracker and open. These five are
 * stated as subset constraints in barwise/docs/adr/governance.orm.yaml,
 * and check:architecture no longer judges them: this check fills the
 * schema's populations from the repository and @barwise/core's population
 * validation judges them. Each finding prints the message
 * check:architecture printed before.
 *
 * Exit codes (docs/adr/gate-refusal-contract.md):
 *   0  no finding
 *   1  a finding
 *   2  could not answer: the model's own refusal (core not built or not
 *      loadable, the schema or population would not load, a rule's
 *      constraint missing or deontic, an error or message it cannot
 *      classify), whatever else it found, since a rule may have gone
 *      unjudged; or, with no finding, an input it reads that could not be
 *      read
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
  // Core is code, not an input of the tree being judged: found beside this
  // script, so --root names a fixture without needing a build inside it.
  corePath = opt("--core") ?? join(here, "..", "packages", "core", "dist", "index.js");
} catch (err) {
  refuse(err instanceof Error ? err.message : String(err));
}

// Every import is loaded here, in one place that can refuse. The CI step
// runs under !cancelled(), so after a failed `npm ci` too, when `yaml`
// may be missing: an import that throws must be exit 2, never Node's
// uncaught-error exit 1, which reads as a finding.
let core, YAML, facts, population, section, readFileSync;
try {
  ({ readFileSync } = await import("node:fs"));
  core = await import(pathToFileURL(isAbsolute(corePath) ? corePath : resolve(corePath)).href);
  YAML = (await import("yaml")).default;
  facts = await import("./lib/adr-facts.mjs");
  population = await import("./lib/adr-population.mjs");
  section = await import("./lib/architecture-section.mjs");
} catch (err) {
  refuse(
    `a dependency would not load (${err instanceof Error ? err.message : String(err)}).\n`
      + "  @barwise/core must be built first: npm run build:core.",
  );
}
const { RULES, modelJudge } = population;
const { createGovernanceReader } = facts;
const { isAdr, readFiles, trackedPaths } = section;

const SCHEMA = join(root, "barwise", "docs", "adr", "governance.orm.yaml");

async function main() {
  const adrs = readFiles(root, trackedPaths(root).filter(isAdr));
  const schemaText = readFileSync(SCHEMA, "utf8");
  if (adrs.length === 0) refuse(`no ADR under ${join(root, "barwise", "docs", "adr")}`);

  // The reader records an unreadable input's refusal once, at the first
  // ask; the builder asks only for package.json and the tracker.
  const refusals = [];
  const model = modelJudge(
    adrs,
    await createGovernanceReader(root, { needsWorkflow: false, refusals }),
    { core, YAML, schemaText },
  );

  // Still exit 2, since a rule may have gone unjudged, but what it did find
  // is printed, so an author can fix that while the model is repaired.
  if (model.self.length > 0) {
    for (const f of model.findings) console.error(`  ${f.message}`);
    console.error("check:adr-model: the model could not answer, so a rule may have gone unjudged:");
    for (const s of model.self) console.error(`  ${s}`);
    process.exit(2);
  }
  if (model.findings.length > 0) {
    console.error(
      `check:adr-model: FAIL -- ${model.findings.length} Enforced-by: problem(s)`
        + " the governance schema finds:",
    );
    for (const f of model.findings) console.error(`  ${f.message}`);
    for (const r of refusals) console.error(`  cannot answer: ${r}`);
    console.error(
      "Every decision needs an entry, every listed id a decision, every named script a"
        + " package.json script, and every cited issue an open tracker issue"
        + " (docs/specs/adr-conformance-model.spec.md).",
    );
    process.exit(1);
  }
  if (refusals.length > 0) {
    console.error("check:adr-model: cannot answer for an input it could not read:");
    for (const r of refusals) console.error(`  ${r}`);
    process.exit(2);
  }
  console.log(
    `check:adr-model: ${adrs.length} ADRs hold the governance schema's rules`
      + ` (${RULES.map((r) => r.id).join(", ")}). OK`,
  );
}

// Anything thrown past the imports is an answer this check could not give:
// exit 2, never Node's uncaught-error exit 1, which reads as a finding.
try {
  await main();
} catch (err) {
  refuse(`an unexpected error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
}
