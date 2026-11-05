// Stub cases: both judges, each with its own reader over the same answers.
import { codeJudge, compare, exitOf, modelJudge } from "./judge.mjs";
const stub = (
  {
    scripts = { "check:x": "x", "check:a]b": "y" },
    issues = [["barwise-a", "open"], ["barwise-c", "closed"]],
    steps = () => [],
  } = {},
) =>
(refusals) => {
  const once = (label, value) => {
    let asked = false;
    return () => {
      if (value === null && !asked) refusals.push(`${label}: unreadable`);
      asked = true;
      return value;
    };
  };
  // The workflow's refusal, like the real reader's, is pushed at most once.
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
const adr = (name, header, decisions) => ({
  f: `barwise/docs/adr/${name}.md`,
  text: `# ${name}\n\n${header === null ? "" : `Enforced-by: ${header}\n`}\n## Decision\n\n`
    + decisions.map((d, i) => `${i + 1}. **D${i}** {#${d}}. Text.\n`).join(""),
});
let agree = 0, total = 0;
// codeJudge pushes into the list its reader was built with:
const pair = (mk) => {
  const list = [];
  return [mk(list), list];
};
const showR = (name, adrs, mk = stub(), opts = {}) => {
  total++;
  const [cr, cl] = pair(mk);
  const code = codeJudge(adrs, cr, cl);
  const [mr, ml] = pair(mk);
  const model = modelJudge(adrs, mr, ml, opts);
  const c = compare(code, model);
  const ok = c.diff.length === 0 && c.refusalDiff.length === 0 && c.refused.length === 0;
  if (ok) agree++;
  console.log(
    `== ${name}: ${ok ? "AGREE" : "DISAGREE"} (exit ${exitOf(code, model, c)})`
      + ` code=[${code.findings}] model=[${model.findings}]`
      + ` refusals code ${cl.length} model ${ml.length}`,
  );
  for (const x of [...c.diff, ...c.refusalDiff, ...c.refused.map((o) => `model refused: ${o}`)]) {
    console.log("   " + x);
  }
};
showR("clean", [adr("a", "npm run check:x (one), none (barwise-a: two)", ["one", "two"])]);
showR("unknown id", [adr("a", "npm run check:x (one, ghost)", ["one"])]);
showR("two entries list the same unknown id", [
  adr("a", "npm run check:x (one, ghost), tests (ghost)", ["one"]),
]);
showR("uncovered decision", [adr("a", "npm run check:x (one)", ["one", "two"])]);
showR("missing script", [adr("a", "npm run check:gone (one)", ["one"])]);
showR("two ADRs name the same missing script", [
  adr("a", "npm run check:gone (one)", ["one"]),
  adr("b", "npm run check:gone (one)", ["one"]),
]);
showR("not a gate name, and undefined", [adr("a", "npm run build (one)", ["one"])]);
showR("a meta gate vouching for the wrong ADR", [
  adr("a", "npm run check:adr-tests (one)", ["one"]),
]);
showR("untracked issue", [adr("a", "none (barwise-zz: one)", ["one"])]);
showR("closed issue", [adr("a", "none (barwise-c: one)", ["one"])]);
showR("headerless ADR", [adr("a", null, ["one"])]);
showR(
  "package.json unreadable",
  [adr("a", "npm run check:x (one)", ["one"])],
  stub({ scripts: null }),
);
showR(
  "package.json unreadable, no npm entry asks",
  [adr("a", "none (barwise-a: one)", ["one"])],
  stub({ scripts: null }),
);
showR("tracker unreadable", [adr("a", "none (barwise-a: one)", ["one"])], stub({ issues: null }));
showR(
  "tracker unreadable, no none entry asks",
  [adr("a", "npm run check:x (one)", ["one"])],
  stub({ issues: null }),
);
showR(
  "a tag names a decision that does not exist",
  [adr("a", "npm run check:x (one)", ["one"])],
  stub(),
  { tags: [["t1", "a#gone"]] },
);
showR("a script named with a bracket, undefined", [adr("a", "npm run check:c]d (one)", ["one"])]);
showR(
  "ci.yml unreadable (a code-only refusal)",
  [adr("a", "npm run check:x (one)", ["one"])],
  stub({
    steps: (c, rf) => {
      rf.push(".github/workflows/ci.yml: unreadable");
      return null;
    },
  }),
);
showR(
  "a step guard this check cannot read (a code-only refusal)",
  [adr("a", "npm run check:x (one)", ["one"])],
  stub({
    steps: (
      c,
    ) => [{
      run: c,
      workingDirectory: "barwise",
      continueOnError: false,
      condition: "github.event_name == 'push'",
    }],
  }),
);
showR("one missing meta gate, two ADRs, one the verdict skips", [
  adr("a", "npm run check:architecture (one)", ["one"]),
  adr("package-graph-authority", "npm run check:architecture (one)", ["one"]),
]);
showR("two identical entries name one missing script", [
  adr("a", "npm run check:gone (one), npm run check:gone (one)", ["one"]),
]);
showR(
  "ci.yml unreadable, two npm entries ask (one refusal)",
  [adr("a", "npm run check:x (one), npm run check:x -- --y (one)", ["one"])],
  stub({
    steps: (c, rf) => {
      rf.push(".github/workflows/ci.yml: unreadable");
      return null;
    },
  }),
);
showR("an entry lists one unknown id twice", [
  adr("a", "npm run check:x (one, ghost, ghost)", ["one"]),
]);
showR("a malformed entry before a finding", [adr("a", "bogus, npm run check:gone (one)", ["one"])]);
showR("two identical entries, each listing one unknown id twice", [
  adr("a", "npm run check:x (one, ghost, ghost), npm run check:x (one, ghost, ghost)", ["one"]),
]);
console.log(`\n${agree} of ${total} stub cases agree`);
