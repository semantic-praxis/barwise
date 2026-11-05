/**
 * The ADR governance schema as a second judge, against the code judge
 * (docs/specs/adr-conformance-model.spec.md, WS3). Both judges run on one
 * input through stub readers, each its own, as check:adr-model runs them
 * on the real tree; the cases are the prototype's
 * (docs/specs/adr-conformance-model.prototype/) and the spec's.
 *
 * Every test registers whether or not @barwise/core is built, and skips
 * when it is not, so the count test:scripts holds this file to does not
 * depend on a build. test:scripts runs before the build and sees them
 * skip; test:adr-model runs them after it, and refuses if any skipped.
 * Every disagreement CI reports becomes a case here, in the commit that
 * resolves it: this file's history is the record WS4 starts from.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";
import { judgeDeclarations, RULES } from "../lib/adr-judge.mjs";
import { compareJudges, factStrings, modelJudge } from "../lib/adr-population.mjs";

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
  steps = () => [],
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
  let stepsAsked = false;
  return {
    scripts: once("barwise/package.json", scripts),
    steps: (cmd) => {
      const into = stepsAsked ? [] : refusals;
      stepsAsked = true;
      return steps(cmd, into);
    },
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

/** Both judges on one input: their findings, refusals and disagreements. */
function both(adrs, mk = stub(), schemaText = SCHEMA_TEXT) {
  const codeRefusals = [];
  const code = judgeDeclarations(adrs, mk(codeRefusals), codeRefusals);
  const modelRefusals = [];
  const model = modelJudge(adrs, mk(modelRefusals), { core, YAML, schemaText, rules: RULES });
  const disagreements = model.self.length > 0 ? [] : compareJudges({
    codeFacts: factStrings(code.facts),
    codeRefusals,
    modelFindings: model.findings,
    modelRefusals,
    rules: RULES,
  });
  return { code: factStrings(code.facts), model, codeRefusals, modelRefusals, disagreements };
}
// Agreement means the model answered: a refusal skips the comparison and
// would otherwise pass as an empty list of disagreements.
const agrees = (name, r) => {
  assert.deepEqual(r.model.self, [], `${name}: the model refused`);
  assert.deepEqual(r.disagreements, [], name);
};

test(
  "adr-model: one planted violation per RULES rule, each found by both judges alike",
  { skip },
  () => {
    const planted = {
      "ids-exist": [adr("a", "npm run check:x (one, ghost)", ["one"])],
      coverage: [adr("a", "npm run check:x (one)", ["one", "two"])],
      "script-exists": [adr("a", "npm run check:gone (one)", ["one"])],
      "issue-tracked": [adr("a", "none (barwise-zz: one)", ["one"])],
      "issue-open": [adr("a", "none (barwise-c: one)", ["one"])],
    };
    // Enumerated from RULES, so a rule added there without a case fails here.
    for (const { id } of RULES) {
      assert.ok(planted[id], `no planted case for ${id}`);
      const r = both(planted[id]);
      agrees(id, r);
      assert.ok(r.code.some((x) => x.startsWith(`${id}|`)), `${id}: the code judge found it`);
      assert.ok(r.model.findings.some((x) => x.startsWith(`${id}|`)), `${id}: the model found it`);
    }
    agrees(
      "clean",
      both([adr("a", "npm run check:x (one), none (barwise-a: two)", ["one", "two"])]),
    );
  },
);

test(
  "adr-model: entries are compared by position, and repeats count as the code judge counts them",
  { skip },
  () => {
    const cases = {
      "two entries list one unknown id": "npm run check:x (one, ghost), tests (ghost)",
      "two identical entries": "npm run check:gone (one), npm run check:gone (one)",
      "an id listed twice in one entry": "npm run check:x (one, ghost, ghost)",
      "identical entries, each listing an id twice":
        "npm run check:x (one, ghost, ghost), npm run check:x (one, ghost, ghost)",
      "a malformed entry before a finding": "bogus, npm run check:gone (one)",
    };
    for (const [name, header] of Object.entries(cases)) {
      agrees(
        name,
        both([adr("a", header, ["one"])]),
      );
    }
    agrees(
      "one missing script named by two ADRs",
      both([
        adr("a", "npm run check:gone (one)", ["one"]),
        adr("b", "npm run check:gone (one)", ["one"]),
      ]),
    );
    // check:architecture vouches only for package-graph-authority, so the
    // shared verdict skips the first entry and both judges see one finding.
    agrees(
      "one missing meta gate on two entries the verdict splits",
      both([
        adr("a", "npm run check:architecture (one)", ["one"]),
        adr("package-graph-authority", "npm run check:architecture (one)", ["one"]),
      ], stub({ scripts: { "check:x": "x" } })),
    );
    agrees("a script named with a ]", both([adr("a", "npm run check:c]d (one)", ["one"])]));
    agrees("a script the verdict rejects", both([adr("a", "npm run build (one)", ["one"])]));
    agrees("a headerless ADR", both([adr("a", null, ["one"])]));
  },
);

test("adr-model: an untracked issue is also not open, which the code judge's chain shadows", {
  skip,
}, () => {
  const r = both([adr("a", "none (barwise-zz: one)", ["one"])]);
  assert.deepEqual(r.code, ["issue-tracked|a|0|barwise-zz"]);
  assert.deepEqual(r.model.findings.sort(), [
    "issue-open|a|0|barwise-zz",
    "issue-tracked|a|0|barwise-zz",
  ]);
  agrees("shadowed", r);
});

test(
  "adr-model: an input neither can read is the same refusal for both, and the code judge's own are not compared",
  { skip },
  () => {
    for (
      const [name, adrs, mk] of [
        [
          "package.json, asked",
          [adr("a", "npm run check:x (one)", ["one"])],
          stub({ scripts: null }),
        ],
        [
          "package.json, not asked",
          [adr("a", "none (barwise-a: one)", ["one"])],
          stub({ scripts: null }),
        ],
        ["tracker, asked", [adr("a", "none (barwise-a: one)", ["one"])], stub({ issues: null })],
        [
          "tracker, not asked",
          [adr("a", "npm run check:x (one)", ["one"])],
          stub({ issues: null }),
        ],
      ]
    ) {
      const r = both(adrs, mk);
      agrees(name, r);
      assert.equal(r.codeRefusals.length, r.modelRefusals.length, name);
    }
    // ci.yml and a step guard belong to the step rule, which the model does
    // not judge: refusals of the code judge alone, and no disagreement.
    const ciUnreadable = stub({
      steps: (c, rf) => {
        rf.push(".github/workflows/ci.yml: unreadable");
        return null;
      },
    });
    const ci = both(
      [adr("a", "npm run check:x (one), npm run check:x -- --y (one)", ["one"])],
      ciUnreadable,
    );
    agrees("ci.yml unreadable", ci);
    assert.equal(ci.codeRefusals.length, 1, "the workflow's refusal is pushed once");
    const guard = stub({
      steps: (
        c,
      ) => [{
        run: c,
        workingDirectory: "barwise",
        continueOnError: false,
        condition: "github.event_name == 'push'",
      }],
    });
    agrees(
      "a step guard it cannot read",
      both([adr("a", "npm run check:x (one)", ["one"])], guard),
    );
  },
);

test(
  "adr-model: the model's own refusals mean no answer, and nothing is compared",
  { skip },
  () => {
    const doc = () => YAML.parse(SCHEMA_TEXT);
    const finding = [adr("a", "npm run check:gone (one)", ["one"])];
    // A deontic rule would report its violations as warnings, so never.
    const deontic = doc();
    for (const c of deontic.model.constraints) if (c.id === "script-exists") c.modality = "deontic";
    const d = both(finding, stub(), YAML.stringify(deontic));
    assert.match(d.model.self.join("\n"), /script-exists is deontic/);
    assert.deepEqual(d.disagreements, [], "not compared");
    // A schema the population cannot load into: a fact type it lacks.
    const lacking = doc();
    lacking.model.fact_types = lacking.model.fact_types.filter((f) =>
      f.id !== "Entry_names_Script"
    );
    lacking.model.constraints = lacking.model.constraints.filter((c) => c.id !== "script-exists");
    assert.match(
      both(finding, stub(), YAML.stringify(lacking)).model.self.join("\n"),
      /would not load/,
    );
    // An error that is not a RULES subset violation: a mandatory constraint
    // the population breaks.
    const extra = doc();
    extra.model.fact_types.find((f) => f.id === "Entry_names_Script").constraints.push({
      type: "mandatory",
      role: "Entry_names_Script.names",
    });
    const e = both(
      [adr("a", "npm run check:x (one), tests (one)", ["one"])],
      stub(),
      YAML.stringify(extra),
    );
    assert.match(e.model.self.join("\n"), /an error it cannot classify/);
    // A rule stated the other way round: script-exists with its roles
    // reversed reports a defined script no entry names, which no entry
    // carries, so it is a refusal rather than a silent agreement.
    const reversed = doc();
    const se = reversed.model.constraints.find((c) => c.id === "script-exists");
    [se.subset_roles, se.superset_roles] = [se.superset_roles, se.subset_roles];
    const rv = both([adr("a", "npm run check:x (one)", ["one"])], stub(), YAML.stringify(reversed));
    assert.match(
      rv.model.self.join("\n"),
      /script-exists: a violation of check:a\]b that no entry carries/,
    );
  },
);

test("adr-model: core's subset message has the shape the key is read from", { skip }, () => {
  const r = both([adr("a", "npm run check:gone (one)", ["one"])]);
  assert.deepEqual(r.model.findings, ["script-exists|a|0|check:gone"]);
  // The shape itself, from core, so a change to its wording fails here
  // rather than turning into a refusal on every run.
  const msg = new core.ValidationEngine().validate(
    new core.OrmYamlSerializer().deserialize(YAML.stringify({
      ...YAML.parse(SCHEMA_TEXT),
      model: {
        ...YAML.parse(SCHEMA_TEXT).model,
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
