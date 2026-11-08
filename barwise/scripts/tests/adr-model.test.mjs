/**
 * The ADR governance schema as the judge of five rules
 * (docs/specs/adr-conformance-model.spec.md, WS4): listed ids exist, every
 * decision has an entry, a named script is in package.json, a cited issue
 * is tracked and open. check:architecture no longer judges them, so these
 * cases are their tests: each rule's planted violation with the exact
 * message check:architecture printed, repeats and entry positions, the
 * chain, the cases that must stay silent (they are check:architecture's,
 * or need an input no entry asks for), the reader's refusals and the
 * model's own, and check:adr-model end to end on a fixture repository.
 *
 * Every test registers whether or not @barwise/core is built, and skips
 * when it is not, so the count test:scripts holds this file to does not
 * depend on a build. test:scripts runs after the build in CI, so they run
 * there; on a tree with no build they skip, and test:adr-model refuses if
 * any skipped.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";
import { modelJudge, RULES } from "../lib/adr-population.mjs";

const BARWISE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let core = null;
try {
  core = await import(pathToFileURL(join(BARWISE, "packages", "core", "dist", "index.js")).href);
} catch {
  core = null;
}
const skip = core === null ? "@barwise/core is not built (npm run build:core)" : false;
const SCHEMA_TEXT = readFileSync(join(BARWISE, "docs", "adr", "governance.orm.yaml"), "utf8");

// A stub reader over fixed answers. An unreadable input answers null and
// records its refusal once, at the first ask, as createGovernanceReader does.
const stub = ({
  scripts = { "check:x": "x", "check:a]b": "y" },
  issues = [["barwise-a", "open"], ["barwise-c", "closed"]],
} = {}) =>
(refusals) => {
  const once = (label, value) => {
    let asked = false;
    return () => {
      if (value === null && !asked) refusals.push(`${label}: unreadable`);
      asked = true;
      return value;
    };
  };
  return {
    scripts: once("barwise/package.json", scripts),
    steps: () => [],
    issues: once(
      ".beads/issues.jsonl",
      issues === null ? null : new Map(issues.map(([id, status]) => [id, { status }])),
    ),
  };
};
const adr = (name, header, ids) => ({
  f: `barwise/docs/adr/${name}.md`,
  text: `# ${name}\n\n${header === null ? "" : `Enforced-by: ${header}\n`}\n## Decision\n\n`
    + ids.map((d, i) => `${i + 1}. **D${i}** {#${d}}. Text.\n`).join(""),
});

/** The model on one input: its messages, findings, own refusals, and the reader's. */
function judge(adrs, mk = stub(), schemaText = SCHEMA_TEXT) {
  const refusals = [];
  const r = modelJudge(adrs, mk(refusals), { core, YAML, schemaText });
  return { ...r, messages: r.findings.map((f) => f.message), refusals };
}
// A clean answer: the model answered, found nothing, and refused nothing.
const silent = (name, r) => {
  assert.deepEqual(r.self, [], `${name}: the model refused`);
  assert.deepEqual(r.messages, [], name);
  assert.deepEqual(r.refusals, [], `${name}: a refusal`);
};
const A = "barwise/docs/adr/a.md";

test(
  "adr-model: one planted violation per RULES rule, with check:architecture's message",
  { skip },
  () => {
    const planted = {
      "ids-exist": [
        [adr("a", "npm run check:x (one, ghost)", ["one"])],
        `${A}: "npm run check:x (one, ghost)" lists ghost, which no decision here has`,
      ],
      coverage: [
        [adr("a", "npm run check:x (one)", ["one", "two"])],
        `${A}: decision 2 {#two} has no Enforced-by: entry`,
      ],
      "script-exists": [
        [adr("a", "npm run check:gone (one)", ["one"])],
        `${A}: "npm run check:gone (one)": barwise/package.json has no script check:gone`,
      ],
      "issue-tracked": [
        [adr("a", "none (barwise-zz: one)", ["one"])],
        `${A}: "none (barwise-zz: one)": barwise-zz is not in .beads/issues.jsonl`,
      ],
      "issue-open": [
        [adr("a", "none (barwise-c: one)", ["one"])],
        `${A}: "none (barwise-c: one)": barwise-c is closed; declare the enforcer it built,`
        + " or reopen it",
      ],
    };
    // Enumerated from RULES, so a rule added there without a case fails here.
    for (const { id } of RULES) {
      assert.ok(planted[id], `no planted case for ${id}`);
      const [adrs, message] = planted[id];
      const r = judge(adrs);
      assert.deepEqual(r.self, [], id);
      assert.deepEqual(r.messages, [message], id);
      assert.deepEqual(r.findings.map((f) => f.rule), [id], id);
    }
    silent(
      "clean",
      judge([adr("a", "npm run check:x (one), none (barwise-a: two)", ["one", "two"])]),
    );
  },
);

test(
  "adr-model: a value on several entries is one finding per entry, and per listing",
  { skip },
  () => {
    const at = (r) => r.findings.map((f) => `${f.rule}|${f.position}`);
    // Two entries list one unknown id: one finding each.
    const two = judge([adr("a", "npm run check:x (one, ghost), tests (ghost)", ["one"])]);
    assert.deepEqual(at(two), ["ids-exist|0", "ids-exist|1"]);
    // One entry lists it twice: two findings, as check:architecture counted.
    assert.deepEqual(at(judge([adr("a", "npm run check:x (one, ghost, ghost)", ["one"])])), [
      "ids-exist|0",
      "ids-exist|0",
    ]);
    // Identical entries, each listing it twice: four, placed by position.
    const ident = judge([
      adr("a", "npm run check:x (one, ghost, ghost), npm run check:x (one, ghost, ghost)", ["one"]),
    ]);
    assert.deepEqual(at(ident), ["ids-exist|0", "ids-exist|0", "ids-exist|1", "ids-exist|1"]);
    // A malformed part is not an entry, so the next entry is at 0.
    const malformed = judge([adr("a", "bogus, npm run check:gone (one)", ["one"])]);
    assert.deepEqual(at(malformed), ["script-exists|0"]);
    // One missing script named by two ADRs: one finding for each.
    const both = judge([
      adr("a", "npm run check:gone (one)", ["one"]),
      adr("b", "npm run check:gone (one)", ["one"]),
    ]);
    assert.deepEqual(both.findings.map((f) => f.adr), ["a", "b"]);
    // A value containing "]" is read whole from core's message.
    assert.deepEqual(
      judge([adr("a", "npm run check:c]d (one)", ["one"])]).findings.map((f) => f.key),
      [
        "check:c]d",
      ],
    );
  },
);

test(
  "adr-model: an untracked issue reports only that, not also that it is not open",
  { skip },
  () => {
    const r = judge([adr("a", "none (barwise-zz: one)", ["one"])]);
    assert.deepEqual(r.findings.map((f) => f.rule), ["issue-tracked"]);
  },
);

test(
  "adr-model: what is check:architecture's, or needs an input no entry asks for, is silent",
  { skip },
  () => {
    // A script the shared verdict rejects: check:architecture reports the
    // gate name or the meta gate, and it is never looked up here.
    silent(
      "not a gate name",
      judge([adr("a", "npm run build (one)", ["one"])], stub({ scripts: {} })),
    );
    silent(
      "a meta gate for the wrong ADR",
      judge([adr("a", "npm run check:architecture (one)", ["one"])], stub({ scripts: {} })),
    );
    // A headerless ADR: check:architecture reports the missing header.
    silent("headerless", judge([adr("a", null, ["one"])]));
    // An unreadable input no entry asks for is no refusal.
    silent(
      "package.json unreadable, no npm entry",
      judge([adr("a", "none (barwise-a: one)", ["one"])], stub({ scripts: null })),
    );
    silent(
      "tracker unreadable, no none entry",
      judge([adr("a", "npm run check:x (one)", ["one"])], stub({ issues: null })),
    );
  },
);

test(
  "adr-model: an input it asks for and cannot read is a refusal, and no finding",
  { skip },
  () => {
    const pkg = judge([adr("a", "npm run check:x (one)", ["one"])], stub({ scripts: null }));
    assert.deepEqual(pkg.messages, []);
    assert.deepEqual(pkg.refusals, ["barwise/package.json: unreadable"]);
    const tracker = judge([adr("a", "none (barwise-a: one)", ["one"])], stub({ issues: null }));
    assert.deepEqual(tracker.messages, []);
    assert.deepEqual(tracker.refusals, [".beads/issues.jsonl: unreadable"]);
  },
);

test(
  "adr-model: the model's own refusals: a schema that could leave a rule unjudged",
  { skip },
  () => {
    const doc = () => YAML.parse(SCHEMA_TEXT);
    const finding = [adr("a", "npm run check:gone (one)", ["one"])];
    // A deontic rule would report its violations as warnings, so never.
    const deontic = doc();
    for (const c of deontic.model.constraints) if (c.id === "script-exists") c.modality = "deontic";
    assert.match(
      judge(finding, stub(), YAML.stringify(deontic)).self.join("\n"),
      /script-exists is deontic/,
    );
    // A rule the schema no longer states.
    const dropped = doc();
    dropped.model.constraints = dropped.model.constraints.filter((c) => c.id !== "coverage");
    assert.match(
      judge(finding, stub(), YAML.stringify(dropped)).self.join("\n"),
      /the schema states no constraint coverage/,
    );
    // A schema the population cannot load into: a fact type it lacks.
    const lacking = doc();
    lacking.model.fact_types = lacking.model.fact_types.filter((f) =>
      f.id !== "Entry_names_Script"
    );
    lacking.model.constraints = lacking.model.constraints.filter((c) => c.id !== "script-exists");
    assert.match(judge(finding, stub(), YAML.stringify(lacking)).self.join("\n"), /would not load/);
    // An error that is not a RULES subset violation.
    const extra = doc();
    extra.model.fact_types.find((f) => f.id === "Entry_names_Script").constraints.push({
      type: "mandatory",
      role: "Entry_names_Script.names",
    });
    assert.match(
      judge(
        [adr("a", "npm run check:x (one), tests (one)", ["one"])],
        stub(),
        YAML.stringify(extra),
      )
        .self.join("\n"),
      /an error it cannot classify/,
    );
    // A rule stated the other way round: a violation no entry carries.
    const reversed = doc();
    const se = reversed.model.constraints.find((c) => c.id === "script-exists");
    [se.subset_roles, se.superset_roles] = [se.superset_roles, se.subset_roles];
    assert.match(
      judge([adr("a", "npm run check:x (one)", ["one"])], stub(), YAML.stringify(reversed)).self
        .join("\n"),
      /script-exists: a violation of check:a\]b that no entry carries/,
    );
  },
);

test("adr-model: core's subset message has the shape the key is read from", { skip }, () => {
  const base = YAML.parse(SCHEMA_TEXT);
  const msg = new core.ValidationEngine().validate(
    new core.OrmYamlSerializer().deserialize(YAML.stringify({
      ...base,
      model: {
        ...base.model,
        populations: [{
          id: "Entry_names_Script.population",
          fact_type: "Entry_names_Script",
          instances: [{
            id: "Entry_names_Script.population.1",
            role_values: {
              "Entry_names_Script.names": "a:0",
              "Entry_names_Script.is_named_by": "x]y",
            },
          }],
        }],
      },
    })),
  ).find((x) => x.elementId === "script-exists").message;
  assert.match(msg, /^Subset constraint is violated: tuple \[x\]y\] in roles \[/);
});

// A committed fixture repository: one ADR, the real schema, a package.json
// and a tracker, read through the real reader by check:adr-model.
function fixture({ header, schema = SCHEMA_TEXT }) {
  const dir = mkdtempSync(join(tmpdir(), "barwise-adr-model-"));
  const put = (rel, body) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  };
  put("barwise/docs/adr/a-concern.md", adr("a-concern", header, ["one"]).text);
  put("barwise/docs/adr/governance.orm.yaml", schema);
  put("barwise/package.json", JSON.stringify({ scripts: { "check:x": "node x.mjs" } }));
  put(".beads/issues.jsonl", '{"id":"barwise-a","status":"open","title":"a"}\n');
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}
const run = (dir) =>
  spawnSync(process.execPath, [join(BARWISE, "scripts", "check-adr-model.mjs"), "--root", dir], {
    encoding: "utf8",
  });

test(
  "check:adr-model: exit 0 clean, 1 on a finding, 2 on its own refusal beside one",
  { skip },
  () => {
    const clean = fixture({ header: "npm run check:x (one)" });
    const found = fixture({ header: "npm run check:x (one, ghost)" });
    const deontic = YAML.parse(SCHEMA_TEXT);
    for (const c of deontic.model.constraints) if (c.id === "coverage") c.modality = "deontic";
    const refused = fixture({
      header: "npm run check:x (one, ghost)",
      schema: YAML.stringify(deontic),
    });
    try {
      const ok = run(clean);
      assert.equal(ok.status, 0, ok.stdout + ok.stderr);
      assert.match(ok.stdout, /check:adr-model: 1 ADRs hold the governance schema's rules/);
      const bad = run(found);
      assert.equal(bad.status, 1, bad.stdout + bad.stderr);
      assert.match(bad.stderr, /a-concern\.md: "npm run check:x \(one, ghost\)" lists ghost/);
      // A rule may have gone unjudged, so the finding beside it is not the
      // answer: exit 2, never the finding code.
      const no = run(refused);
      assert.equal(no.status, 2, no.stdout + no.stderr);
      assert.match(no.stderr, /coverage is deontic/);
    } finally {
      for (const d of [clean, found, refused]) rmSync(d, { recursive: true, force: true });
    }
  },
);
