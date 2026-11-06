/**
 * check-eval-coverage (docs/specs/adr-batch9-enforcers.spec.md, WS5): the
 * tier and inventory parsers and the rules on plain data, and the gate end
 * to end over a fixture copy of the real suite, ADR and inventory.
 *
 * The rule and parser cases need no build. The end-to-end cases run the
 * gate, which imports the built @barwise/core and @barwise/learn, so they
 * register always and skip when either is missing: test:scripts runs before
 * the build in CI and sees them skip, while the gate's own CI step and its
 * probes run after it. The fixture is a copy of the real files, so it is
 * green for the reason the repository is and each plant is red for one.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findings, parseInventory, parseTiers, Refusal, tally } from "../check-eval-coverage.mjs";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");
const BARWISE = join(SCRIPTS, "..");
const GATE = join(SCRIPTS, "check-eval-coverage.mjs");
const DIST = ["core", "learn"].map((p) => join(BARWISE, "packages", p, "dist", "index.js"));
const skip = DIST.every(existsSync) ? false : "core and learn are not built (npm run build)";

// --- parsers, on small texts ---

const ADR = (common, rare) =>
  `## Decision\n\n1. **One.**{#one} text.\n\n2. **Types are tiered by occurrence.**{#tiered-types}\n   Common tier (each owed two): ${common} -- rules real\n   sessions state. Rare tier: ${rare} -- textbook types.\n   Their home is a gym.\n\n3. **Three.**{#three} x.\n`;
const TYPES = ["a", "b", "c", "subset"];

test("parseTiers reads both tiers from the backticks, across wrapped lines", () => {
  const tiers = parseTiers(ADR("`a`, `b`,\n   `subset`", "`c`"), TYPES);
  assert.deepEqual([...tiers], [["a", "common"], ["b", "common"], ["subset", "common"], [
    "c",
    "rare",
  ]]);
});

test("parseTiers refuses where it cannot tell a tier from its absence", () => {
  const refused = (text, pattern) =>
    assert.throws(
      () => parseTiers(text, TYPES),
      (e) => e instanceof Refusal && pattern.test(e.message),
    );
  refused("## Decision\n\n1. **One.**{#one}\n", /no decision 2/);
  refused(ADR("`a`, `b`", "`c`"), /gives no tier to `subset`/);
  refused(ADR("`a`, `b`, `subset`, `zzz`", "`c`"), /`zzz`, which is no ring/);
  refused(ADR("`a`, `b`, `subset`, `c`", "`c`"), /`c` twice/);
  refused(ADR("none listed", "`c`"), /common tier lists no type/);
});

const SPEC = (
  rows,
  header =
    "| Type | Tier | Reference cases | Rubric-tested train cases | Rubric-tested dev cases | Covered | Notes |",
) => `Intro\n\n${header}\n| --- | --- | --- | --- | --- | --- | --- |\n${rows}\n\nAfter.\n`;

test("parseInventory finds the table by its headers, reads cells by name, ignores the prose column", () => {
  const { rows, duplicates } = parseInventory(
    SPEC("| `a` | common | 2 | 1 | 0 | no | a | b |\n| `b` | rare | 0 | 0 | 0 | no | none |"),
  );
  assert.deepEqual(rows.get("a"), {
    type: "`a`",
    tier: "common",
    refs: "2",
    train: "1",
    dev: "0",
    covered: "no",
  });
  assert.deepEqual(duplicates, []);
  const swapped = parseInventory(
    "| Covered | Type | Tier | Reference cases | Rubric-tested train cases | Rubric-tested dev cases |\n| - | - | - | - | - | - |\n| yes | `a` | common | 1 | 1 | 1 |\n",
  );
  assert.equal(swapped.rows.get("a").covered, "yes");
});

test("parseInventory refuses a missing table, a missing column and an empty table", () => {
  assert.throws(() => parseInventory("no table here"), Refusal);
  assert.throws(
    () => parseInventory("| Type | Covered |\n| - | - |\n| `a` | no |\n"),
    /no "tier" column/,
  );
  assert.throws(() => parseInventory(SPEC("")), /no rows/);
});

// --- rules, on plain data ---

const kase = (id, split, types = [], rubric = []) => ({ id, split, types: new Set(types), rubric });
const row = (tier, refs, train, dev, covered) => ({ tier, refs, train, dev, covered });
const inventory = (rows) => ({ rows: new Map(Object.entries(rows)), duplicates: [] });
const tiers = new Map([["a", "common"], ["b", "common"], ["c", "rare"]]);
const T = ["a", "b", "c"];
const run = (cases, rows) => findings({ cases, tiers, inventory: inventory(rows), types: T });
const agreeing = {
  a: row("common", "2", "1", "1", "yes"),
  b: row("common", "0", "0", "0", "no"),
  c: row("rare", "0", "0", "0", "no"),
};
const AGREEING_CASES = [kase("t1", "train", ["a"], ["a"]), kase("d1", "dev", ["a"], ["a"])];

test("an inventory that agrees with the suite has no finding, and covered:yes is accepted", () => {
  assert.deepEqual(run(AGREEING_CASES, agreeing), []);
});

test("two-instances: covered with one train and no dev is a finding; so is not covered with both", () => {
  const train = [kase("t1", "train", ["a"], ["a"])];
  const found = run(train, { ...agreeing, a: row("common", "1", "1", "0", "yes") });
  assert.deepEqual(found, [
    "two-instances  `a`: marked covered with 1 train, 0 dev (covered means at least one of each)",
  ]);
  const owed = run(AGREEING_CASES, { ...agreeing, a: row("common", "2", "1", "1", "no") });
  assert.match(owed.join("\n"), /two-instances  `a`: marked not covered with 1 train, 1 dev/);
  const odd = run(AGREEING_CASES, { ...agreeing, a: row("common", "2", "1", "1", "maybe") });
  assert.match(odd.join("\n"), /"covered" is "maybe"/);
});

test("two-instances: a case is one domain, so two checks of one type in one case are one instance", () => {
  const twice = [kase("t1", "train", ["a"], ["a", "a"]), kase("t2", "train", ["a"], ["a"])];
  assert.deepEqual(tally(twice, ["a"]).get("a"), { refs: 2, train: 2, dev: 0 });
  // Two train cases, no dev: still not covered, whatever the train count.
  assert.match(
    run(twice, { ...agreeing, a: row("common", "2", "2", "0", "yes") }).join("\n"),
    /marked covered with 2 train, 0 dev/,
  );
});

test("inventory-outside: a derived column that disagrees, a missing row, a stray row, a wrong tier", () => {
  const found = run(AGREEING_CASES, {
    a: row("rare", "3", "x", "1", "yes"),
    c: row("rare", "0", "0", "0", "no"),
    z: row("common", "0", "0", "0", "no"),
  }).join("\n");
  assert.match(found, /inventory-outside  `a`: tier "rare" but the ADR says "common"/);
  assert.match(found, /"reference cases" says 3, the suite has 2/);
  assert.match(found, /"rubric-tested train cases" is "x", not a count/);
  assert.match(found, /inventory-outside  `b` has no inventory row/);
  assert.match(found, /inventory-outside  `z` is a row but no ring or set-comparison type/);
  const dup = findings({
    cases: AGREEING_CASES,
    tiers,
    inventory: { rows: inventory(agreeing).rows, duplicates: ["a"] },
    types: T,
  });
  assert.match(dup.join("\n"), /`a` has more than one inventory row/);
});

test("tiered-types: a rare type in a reference, and one a ring check resolves to, are each a finding", () => {
  const found = run(
    [kase("t1", "train", ["a", "c"], ["a", "c"]), kase("d1", "dev", ["a"], ["a"])],
    {
      ...agreeing,
      c: row("rare", "1", "1", "0", "no"),
    },
  );
  assert.deepEqual(found, [
    "tiered-types  t1: the reference carries rare-tier `c`; a rare type never enters an eval transcript",
    "tiered-types  t1: a forbids_population ring check resolves to rare-tier `c`",
  ]);
});

// --- the gate, over a fixture copy of the real files ---

const ADR_REL = ["docs", "adr", "constraint-coverage-policy.md"];
const SPEC_REL = ["docs", "specs", "constraint-extraction-coverage.spec.md"];
const EVALS_REL = ["packages", "promptlab", "evals"];

/** A fixture repository holding copies of the three inputs, mutated by `edit`. */
function fixture(edit = {}) {
  const root = mkdtempSync(join(tmpdir(), "eval-coverage-"));
  const into = (...p) => join(root, "barwise", ...p);
  for (const rel of [ADR_REL, SPEC_REL]) {
    mkdirSync(dirname(into(...rel)), { recursive: true });
    cpSync(join(BARWISE, ...rel), into(...rel));
  }
  cpSync(join(BARWISE, ...EVALS_REL), into(...EVALS_REL), {
    recursive: true,
    filter: (src) => !/\.(md|jsonl)$/.test(src),
  });
  for (const [file, change] of Object.entries(edit)) {
    const path = into(...file.split("/"));
    writeFileSync(path, change(readFileSync(path, "utf8")));
  }
  return root;
}

function gate(root, ...args) {
  return spawnSync(process.execPath, [GATE, "--root", root, ...args], { encoding: "utf8" });
}

/** Replace one inventory row's cells, leaving its prose column alone. The formatter pads the cells, so the pattern allows any padding. */
const setRow = (type, [refs, train, dev, covered]) => (text) =>
  text.replace(
    new RegExp(
      `^\\| \`${type}\`\\s*\\| (\\w+)\\s*\\| \\d+\\s*\\| \\d+\\s*\\| \\d+\\s*\\| \\w+\\s*\\|`,
      "m",
    ),
    `| \`${type}\` | $1 | ${refs} | ${train} | ${dev} | ${covered} |`,
  );
const SPEC_KEY = SPEC_REL.join("/");
const reference = (name, from, to) => ({
  [`${EVALS_REL.join("/")}/${name}.reference.orm.yaml`]: (t) => {
    assert.ok(t.includes(from), `the fixture reference has no "${from}" to plant over`);
    return t.replace(from, to);
  },
});

function planted(edit, expectPattern, label) {
  const root = fixture(edit);
  try {
    const r = gate(root);
    assert.equal(
      r.status,
      1,
      `${label}: expected a finding (1), got ${r.status}:\n${r.stdout}${r.stderr}`,
    );
    assert.match(r.stderr, expectPattern, label);
    assert.doesNotMatch(r.stdout, /OK/, label);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the gate is green over a copy of the real suite, ADR and inventory", { skip }, () => {
  const root = fixture();
  try {
    const r = gate(root);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /OK -- 10 case\(s\) \(7 train, 3 dev\); 11 type\(s\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "two-instances: marking acyclic covered with one train instance is a finding",
  { skip },
  () => {
    planted(
      { [SPEC_KEY]: setRow("acyclic", [2, 1, 0, "yes"]) },
      /two-instances {2}`acyclic`: marked covered with 1 train, 0 dev/,
      "acyclic covered",
    );
  },
);

test("inventory-outside: an inventory-only edit to a count is a finding", { skip }, () => {
  planted(
    { [SPEC_KEY]: setRow("acyclic", [2, 2, 0, "no"]) },
    /inventory-outside {2}`acyclic`: "rubric-tested train cases" says 2, the suite has 1/,
    "inventory count",
  );
});

test("inventory-outside: changing a reference's ring moves the counts the inventory must follow", {
  skip,
}, () => {
  // irreflexive becomes 1 train + 1 dev (covered) and acyclic drops to one
  // reference case with no train, which the unchanged inventory contradicts.
  const edit = reference("project-staffing", "ring_type: acyclic", "ring_type: irreflexive");
  planted(edit, /`irreflexive`: "rubric-tested train cases" says 0, the suite has 1/, "reference");
  // The same suite with the inventory brought along is green, and covered:yes is accepted.
  const root = fixture({
    ...edit,
    [SPEC_KEY]: (t) =>
      setRow("irreflexive", [2, 1, 1, "yes"])(setRow("acyclic", [1, 0, 0, "no"])(t)),
  });
  try {
    const r = gate(root);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "tiered-types: a rare ring type in a reference and so in a rubric is a finding",
  { skip },
  () => {
    planted(
      reference("project-staffing", "ring_type: acyclic", "ring_type: transitive"),
      /tiered-types {2}project-staffing: a forbids_population ring check resolves to rare-tier `transitive`/,
      "rare in rubric",
    );
    planted(
      reference("project-staffing", "ring_type: acyclic", "ring_type: transitive"),
      /tiered-types {2}project-staffing: the reference carries rare-tier `transitive`/,
      "rare in reference",
    );
  },
);

test(
  "the gate refuses, never passes, over an input or a dependency it cannot read",
  { skip },
  () => {
    const refused = (r, pattern, label) => {
      assert.equal(
        r.status,
        2,
        `${label}: expected a refusal (2), got ${r.status}:\n${r.stdout}${r.stderr}`,
      );
      assert.match(r.stderr, pattern, label);
      assert.doesNotMatch(r.stdout + r.stderr, /OK --/, label);
      assert.doesNotMatch(r.stderr, /at .*\.mjs:\d+/, `${label}: a stack trace is not a refusal`);
    };
    const root = fixture();
    try {
      refused(gate(root, "--core", join(root, "no-core.js")), /would not load/, "no core build");
      refused(gate(root, "--learn", join(root, "no-learn.js")), /would not load/, "no learn build");
      refused(gate(root, "--learn"), /needs a value/, "a flag with no value");
      rmSync(join(root, "barwise", ...SPEC_REL));
      refused(gate(root), /would not read/, "no inventory");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    const noTiers = fixture({
      [ADR_REL.join("/")]: (t) => t.replace("**Types are tiered", "**Types are sorted"),
    });
    try {
      refused(gate(noTiers), /no decision 2/, "an ADR with no tiers");
    } finally {
      rmSync(noTiers, { recursive: true, force: true });
    }
    const noAsym = fixture({ [ADR_REL.join("/")]: (t) => t.replace("`asymmetric`, ", "") });
    try {
      refused(gate(noAsym), /gives no tier to `asymmetric`/, "a ring type with no tier");
    } finally {
      rmSync(noAsym, { recursive: true, force: true });
    }
    const noSplit = fixture({
      [`${EVALS_REL.join("/")}/suite.yaml`]: (t) => t.replace("    - incident-response\n", ""),
    });
    try {
      refused(gate(noSplit), /incident-response is in neither/, "a case in no split");
    } finally {
      rmSync(noSplit, { recursive: true, force: true });
    }
  },
);
