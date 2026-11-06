/**
 * The reads behind the ADR governance gates: the root scripts, ci.yml and
 * the tracker for check:architecture's declaration pass, and the test
 * reports and docs/adr/tested-in.json for check:adr-tests (docs/specs/adr-gate-reader-split.spec.md).
 *
 * Reading only; what an answer means is scripts/lib/adr-judge.mjs's. The
 * split exists so the ADR conformance model can judge the same answers
 * (docs/specs/adr-conformance-model.spec.md), and it changes nothing a gate
 * prints, which holds three properties the gates had inline:
 *   - laziness: an input is read only when a rule first asks for it, so a
 *     tree whose entries need no ci.yml never opens one;
 *   - order: every unreadable input pushes one refusal into the gate's own
 *     list, at the moment it is first asked for, so refusals interleave
 *     with the judge's in the order they always have;
 *   - "cannot read" is `null`, never an empty list or map, which the judge
 *     would read as a finding ("no ci.yml step", "not in the tracker").
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ADR_DIR, isMap, trackedPaths } from "./architecture-section.mjs";
import { parseTracker } from "./beads-merge.mjs";
import { scriptReport, TRIAL_REPORT, vitestReport } from "./test-reports.mjs";

/**
 * check:architecture's governance loaders. `needsWorkflow` is the gate's
 * own reading of whether any ADR declares an npm entry: ci-occurrences.mjs
 * needs the `yaml` package, so it is imported only then, and eagerly, so
 * its refusal stays first. `importCiOccurrences` is a seam for the reader's
 * own tests; the refusal keeps the label it had before the move.
 */
export async function createGovernanceReader(
  root,
  { needsWorkflow, refusals, importCiOccurrences = () => import("./ci-occurrences.mjs") },
) {
  const lazily = (label, load) => {
    let done = false;
    let value = null;
    return () => {
      if (!done) {
        done = true;
        try {
          value = load();
        } catch (err) {
          refusals.push(`${label}: ${err.message}`);
        }
      }
      return value;
    };
  };
  const scripts = lazily("barwise/package.json", () => {
    const json = JSON.parse(readFileSync(join(root, "barwise", "package.json"), "utf8"));
    if (!isMap(json?.scripts)) throw new Error("no scripts object");
    return json.scripts;
  });
  let ciStepOccurrences = null;
  if (needsWorkflow) {
    try {
      ({ ciStepOccurrences } = await importCiOccurrences());
    } catch (err) {
      refusals.push(`scripts/lib/ci-occurrences.mjs: ${err.message}`);
    }
  }
  const allSteps = lazily(".github/workflows/ci.yml", () => {
    if (ciStepOccurrences === null) throw new Error("its reader could not be loaded");
    const found = ciStepOccurrences(join(root, ".github", "workflows", "ci.yml"));
    if (found.length === 0) throw new Error("no steps found; has the workflow moved?");
    return found;
  });
  const issues = lazily(".beads/issues.jsonl", () => {
    const text = readFileSync(join(root, ".beads", "issues.jsonl"), "utf8");
    const parsed = parseTracker(text, ".beads/issues.jsonl");
    if (parsed.length === 0) throw new Error("the tracker holds no issues");
    return new Map(parsed.map(({ obj }) => [obj.id, obj]));
  });
  return {
    /** The root `scripts` object, or `null` when it cannot be read. */
    scripts,
    /**
     * The ci.yml steps whose `run:` is exactly `command` (`npm run <script>`
     * or `npm run <script> -- <args>`), as the workflow states them, or
     * `null` when the workflow cannot be read.
     */
    steps: (command) => {
      const all = allSteps();
      return all === null ? null : all.filter((s) => s.run === command);
    },
    /** The tracker, as a map of id to issue, or `null` when it cannot be read. */
    issues,
  };
}

/**
 * A runner's absolute source path as a repository path: `base` is the
 * report's own directory from the root (`barwise/packages/mcp/`), and the
 * part after its last occurrence below `barwise/` is kept. Turbo's shared
 * cache restores a report written in another checkout (a pre-push worktree
 * under /tmp beside the main one), so the prefix before it is not this
 * root's and is never compared. `null` when the path is absent or does not
 * pass through that directory: the entry then counts for every rule but the
 * per-file one.
 */
export function repoFile(abs, base) {
  if (typeof abs !== "string" || abs === "") return null;
  const anchor = `/${base.slice("barwise/".length)}`;
  const p = `/${abs.replaceAll("\\", "/")}`;
  const i = p.lastIndexOf(anchor);
  if (i < 0) return null;
  const rest = p.slice(i + anchor.length);
  return rest === "" ? null : base + rest;
}

/**
 * Each test or suite a report says ran:
 * `{ title, ancestors, type, status, from, file }`, `file` as repoFile() reads it.
 */
function readVitest(path, rel, base) {
  const json = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(json?.testResults)) throw new Error("no testResults array");
  const out = [];
  for (const file of json.testResults) {
    if (!Array.isArray(file?.assertionResults)) {
      throw new Error("a testResults entry has no assertionResults");
    }
    for (const a of file.assertionResults) {
      if (
        typeof a?.title !== "string" || typeof a?.status !== "string"
        || !Array.isArray(a.ancestorTitles)
      ) {
        throw new Error("an assertionResult has no title, status or ancestorTitles");
      }
      out.push({
        title: a.title,
        ancestors: a.ancestorTitles,
        type: "test",
        status: a.status,
        from: rel,
        file: repoFile(file.name, base),
      });
    }
  }
  return out;
}

function readNodeTest(path, rel, base) {
  const out = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const r = JSON.parse(line);
    if (
      typeof r?.name !== "string" || typeof r?.status !== "string" || typeof r?.type !== "string"
    ) {
      throw new Error("a line has no name, status or type");
    }
    out.push({
      title: r.name,
      ancestors: [],
      type: r.type,
      status: r.status,
      from: rel,
      file: repoFile(r.file, base),
    });
  }
  return out;
}

/**
 * check:adr-tests' reports: every report this run should have written,
 * derived (one per package with a `test:coverage` script, one per file in
 * scripts/tests/expected-counts.json, and the `test:trial` report), and
 * the tests each says ran. A report missing or not of the shape read is a
 * refusal; `unreadable` counts them here, before any decision is judged, so
 * the judge's own refusals cannot change it. Throws when the list itself
 * cannot be built, which the gate reports as it always has.
 */
export function readTestReports(root) {
  const expected = [];
  const pkgs = join(root, "barwise", "packages");
  for (const dir of readdirSync(pkgs, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const manifest = join(pkgs, dir.name, "package.json");
    if (!existsSync(manifest)) continue;
    const scripts = JSON.parse(readFileSync(manifest, "utf8")).scripts ?? {};
    if (Object.hasOwn(scripts, "test:coverage")) {
      expected.push({
        rel: vitestReport(dir.name),
        read: readVitest,
        base: `barwise/packages/${dir.name}/`,
      });
    }
  }
  const counts = JSON.parse(
    readFileSync(join(root, "barwise", "scripts", "tests", "expected-counts.json"), "utf8"),
  );
  for (const file of Object.keys(counts.counts ?? {})) {
    expected.push({ rel: scriptReport(file), read: readNodeTest, base: "barwise/scripts/tests/" });
  }
  expected.push({ rel: TRIAL_REPORT, read: readNodeTest, base: "barwise/trial/tests/" });

  const ran = [];
  const refusals = [];
  for (const { rel, read, base } of expected) {
    const path = join(root, rel);
    if (!existsSync(path)) {
      refusals.push(`${rel}: missing; did its test step run in this checkout?`);
      continue;
    }
    try {
      ran.push(...read(path, rel, base));
    } catch (err) {
      refusals.push(`${rel}: not a report this check reads (${err.message})`);
    }
  }
  return { expected, ran, refusals, unreadable: refusals.length };
}

/** The tested-in manifest, from the repository root. */
export const TESTED_IN = `${ADR_DIR}tested-in.json`;

const isText = (v) => typeof v === "string" && v !== "";

/**
 * check:adr-tests' per-file rows (docs/specs/capability-matrix-check.spec.md,
 * WS2): `{ rows, tracked }`, the `{ decision, files, why }` rows of
 * docs/adr/tested-in.json and the set of the paths they name that git
 * tracks. `null`, with one refusal pushed onto `refusals`, when the file is
 * missing, is not JSON, is not a list of such rows, or the tracked paths
 * cannot be listed: zero rows would read as "nothing to check", which is
 * the answer it could not give.
 */
export function readTestedIn(root, refusals) {
  const refuse = (why) => {
    refusals.push(`${TESTED_IN}: ${why}`);
    return null;
  };
  let rows;
  try {
    rows = JSON.parse(readFileSync(join(root, TESTED_IN), "utf8"));
  } catch (err) {
    return refuse(err.code === "ENOENT" ? "missing" : `not read (${err.message})`);
  }
  if (!Array.isArray(rows)) return refuse("not a list of rows");
  for (const [i, r] of rows.entries()) {
    const ok = r !== null && typeof r === "object" && isText(r.decision)
      && /^[^#\s]+#[^#\s]+$/.test(r.decision) && Array.isArray(r.files) && r.files.length > 0
      && r.files.every(isText) && isText(r.why);
    if (!ok) {
      return refuse(
        `row ${i + 1} is not { decision: "<adr>#<id>", files: [<path>, ...], why }`,
      );
    }
  }
  let all;
  try {
    all = new Set(trackedPaths(root));
  } catch (err) {
    return refuse(`cannot list the tracked paths (${err.message})`);
  }
  const tracked = new Set(rows.flatMap((r) => r.files).filter((f) => all.has(f)));
  return { rows, tracked };
}
