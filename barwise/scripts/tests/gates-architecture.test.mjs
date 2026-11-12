/**
 * Gate tests: check:architecture over the package graph.
 *
 * Split from gates.test.mjs (barwise-bbt) so the gate tests run in parallel;
 * why these tests exist at all is the header of gates-helpers.mjs.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import EXTERNAL from "../lib/external-deps.cjs";
import {
  ARCH,
  ARCH_CMD,
  architectureRepo,
  archPlanted,
  CLAUDE_LLM,
  commented,
  CORE_PKG,
  EXTERNAL_CJS,
  INTENDED_CJS,
  MCP_ROW,
  mutate,
  ROOT_ROW,
  runArch,
  stage,
} from "./gates-helpers.mjs";

// --- check:architecture: the package graph's copies agree with INTENDED ---

/** Each planted disagreement: file, anchor, replacement, the line it must report. */
const ARCH_DISAGREEMENTS = [
  // A dependency added to a commented row: its untouched wraps still read
  // as its comment, so the new edge is compared, not refused.
  [
    "CLAUDE.md",
    "@barwise/dbt             (core, formats)",
    "@barwise/dbt             (core, formats, llm)",
    /CLAUDE\.md draws dbt -> llm, INTENDED does not/,
  ],
  // Both directions of an edge disagreement.
  [
    "CLAUDE.md",
    CLAUDE_LLM,
    "@barwise/llm             (core, diagram)",
    /CLAUDE\.md draws llm -> diagram, INTENDED does not/,
  ],
  [
    "CLAUDE.md",
    CLAUDE_LLM,
    "@barwise/llm             ()",
    /INTENDED has llm -> core, CLAUDE\.md does not/,
  ],
  [
    INTENDED_CJS,
    `"promptlab": ["core", "llm", "learn"]`,
    `"promptlab": ["core", "llm"]`,
    /CLAUDE\.md draws promptlab -> learn/,
  ],
  // Packages present on one side only, or listed twice.
  ["CLAUDE.md", `  |--- ${CLAUDE_LLM}\n`, "", /CLAUDE\.md does not list llm/],
  [
    "CLAUDE.md",
    `  |--- ${CLAUDE_LLM}\n`,
    `  |--- ${CLAUDE_LLM}\n  |--- ${CLAUDE_LLM}\n`,
    /CLAUDE\.md lists llm twice/,
  ],
  [
    "CLAUDE.md",
    CLAUDE_LLM,
    "@barwise/llm             (core, core)",
    /CLAUDE\.md lists llm -> core twice/,
  ],
  [
    "CLAUDE.md",
    CLAUDE_LLM,
    `${CLAUDE_LLM}\n  |--- @barwise/ghost           (core)`,
    /CLAUDE\.md lists @barwise\/ghost, INTENDED does not/,
  ],
  [INTENDED_CJS, `"learn": ["core"],`, "", /packages\/learn: not in INTENDED/],
  // A row for a package with no manifest yet is still compared.
  [
    "CLAUDE.md",
    `  |--- ${CLAUDE_LLM}\n`,
    `  |--- ${CLAUDE_LLM}\n  |--- barwise-jetbrains (core, mcp)\n`,
    /CLAUDE\.md lists barwise-jetbrains, INTENDED does not/,
  ],
  // One edge spelled in both vocabularies is still a duplicate.
  [
    "CLAUDE.md",
    CLAUDE_LLM,
    "@barwise/llm             (core, @barwise/core)",
    /CLAUDE\.md lists llm -> core twice/,
  ],
  // The map agreeing with the picture is not enough.
  [
    INTENDED_CJS,
    `"learn": ["core"],`,
    `"learn": ["cor"],`,
    /INTENDED has learn -> cor, and cor is not a key/,
  ],
  [
    INTENDED_CJS,
    `"learn": ["core"],`,
    `"learn": ["core", "constructor"],`,
    /INTENDED has learn -> constructor, and constructor is not a key/,
  ],
  [
    INTENDED_CJS,
    `"learn": ["core"],`,
    `"learn": ["core", "core"],`,
    /INTENDED lists learn -> core twice/,
  ],
  [
    INTENDED_CJS,
    `"learn": ["core"],`,
    `"learn": ["core", "learn"],`,
    /INTENDED has learn -> learn, a self-edge/,
  ],
  // Each runtime dependency field.
  [
    CORE_PKG,
    `"dependencies": {`,
    `"dependencies": {\n    "@barwise/llm": "*",`,
    /packages\/core: dependencies has @barwise\/llm, INTENDED does not allow it/,
  ],
  [
    CORE_PKG,
    `"dependencies": {`,
    `"peerDependencies": { "@barwise/llm": "*" },\n  "dependencies": {`,
    /packages\/core: peerDependencies has @barwise\/llm/,
  ],
  [
    CORE_PKG,
    `"dependencies": {`,
    `"optionalDependencies": { "barwise-vscode": "*" },\n  "dependencies": {`,
    /packages\/core: optionalDependencies has barwise-vscode/,
  ],
  // Core's external runtime dependencies are its list, both ways
  // (package-graph-authority#core-external-deps): an unlisted one, in a
  // field other than dependencies too, and a listed one core dropped.
  [
    CORE_PKG,
    `"dependencies": {`,
    `"dependencies": {\n    "z3-solver": "^4.13.0",`,
    /packages\/core: dependencies has z3-solver, external-deps\.cjs does not list it/,
  ],
  [
    CORE_PKG,
    `"dependencies": {`,
    `"optionalDependencies": { "z3-solver": "^4.13.0" },\n  "dependencies": {`,
    /packages\/core: optionalDependencies has z3-solver/,
  ],
  [
    EXTERNAL_CJS,
    `[${EXTERNAL.core.map((d) => JSON.stringify(d)).join(", ")}]`,
    `[${[...EXTERNAL.core, "lodash"].map((d) => JSON.stringify(d)).join(", ")}]`,
    /external-deps\.cjs lists lodash for core, which its manifest does not declare/,
  ],
  [
    EXTERNAL_CJS,
    `"core":`,
    `"ghost": [],\n  "core":`,
    /external-deps\.cjs lists ghost, which is not a package under packages\//,
  ],
  // A listed name that installs something else.
  [
    CORE_PKG,
    `"yaml": "^`,
    `"yaml": "npm:z3-solver@^`,
    /packages\/core: dependencies has yaml as "npm:z3-solver@\^/,
  ],
  // The graph copied into a script as an adjacency entry
  // (package-graph-authority#intended-is-graph); the same entry written
  // with manifest names, or under a quoted key, is found as well.
  [
    "barwise/scripts/arch-triage.mjs",
    "const PACKAGES = Object.keys(INTENDED);",
    'const COPY = { "promptlab": ["core"] };\nconst PACKAGES = Object.keys(INTENDED);',
    /arch-triage\.mjs:\d+: "promptlab": \["core"\] is a copy of an INTENDED entry/,
  ],
  [
    "barwise/scripts/arch-triage.mjs",
    "const PACKAGES = Object.keys(INTENDED);",
    'const COPY = { cli: ["@barwise/core", "@barwise/llm"] };\nconst PACKAGES = Object.keys(INTENDED);',
    /arch-triage\.mjs:\d+: "cli": \["@barwise\/core", "@barwise\/llm"\] is a copy/,
  ],
  // A package CLAUDE.md Upstream row INTENDED does not allow, one it lacks,
  // and one that names no package.
  [
    "barwise/packages/diagram/CLAUDE.md",
    "| Upstream   | `@barwise/core`       |",
    "| Upstream   | `@barwise/llm`        | x |\n| Upstream   | `@barwise/core`       |",
    /packages\/diagram\/CLAUDE\.md: Upstream llm, INTENDED does not allow diagram -> llm/,
  ],
  [
    "barwise/packages/diagram/CLAUDE.md",
    "| Upstream   | `@barwise/core`       |",
    "| Downstream | `@barwise/core`       |",
    /INTENDED has diagram -> core, packages\/diagram\/CLAUDE\.md has no Upstream row/,
  ],
  [
    "barwise/packages/diagram/CLAUDE.md",
    "| Upstream   | `@barwise/core`       |",
    "| Upstream   | `@barwise/core`       | x |\n| Upstream   | `@barwise/ghost`      |",
    /packages\/diagram\/CLAUDE\.md: Upstream @barwise\/ghost is not a package in INTENDED/,
  ],
  // Core imports a package its runtime fields do not declare, bare or
  // type-only; a node: or relative import is purity's.
  [
    "barwise/packages/core/src/index.ts",
    "// Model\nexport {",
    'import "fast-check";\n// Model\nexport {',
    /packages\/core\/src\/index\.ts: imports fast-check, which is not in packages\/core's/,
  ],
  [
    "barwise/packages/core/src/index.ts",
    "// Model\nexport {",
    'import type { Arbitrary } from "fast-check/lib/types";\n// Model\nexport {',
    /imports fast-check, which is not in/,
  ],
];

test("check:architecture passes the real graph and catches each planted disagreement", () => {
  const { dir, manifests } = architectureRepo();
  try {
    const clean = runArch(dir);
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    assert.match(clean.stdout, new RegExp(`and ${manifests} package manifests agree`));
    for (const [file, old, replacement, why] of ARCH_DISAGREEMENTS) {
      const r = mutate(dir, ["--file", file, "--old", old, "--new", replacement, ...ARCH]);
      // mutate passes the child's output through, so its own result says
      // both that the check failed and which disagreement it named.
      assert.equal(r.status, 0, `${file}: expected CAUGHT:\n${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /CAUGHT -- the command failed \(exit 1\)/, `${file}: not exit 1`);
      assert.match(r.stderr, why);
    }
    // A package listed twice keeps its first listing: the second invents
    // no edge disagreement beside the real one.
    const twice = archPlanted(
      dir,
      "CLAUDE.md",
      (s) =>
        s.replace(
          `  |--- ${CLAUDE_LLM}\n`,
          `  |--- ${CLAUDE_LLM}\n  |--- @barwise/llm (core, dbt)\n`,
        ),
    );
    assert.equal(twice.status, 1, twice.stderr);
    assert.match(twice.stderr, /CLAUDE\.md lists llm twice/);
    assert.doesNotMatch(twice.stderr, /llm -> /);
    // None of these is a disagreement: comment prose, whatever package
    // names or parentheses it holds, wrapped at its comment's column; npm
    // names inside a list; a directory name as the row name; bare `|`
    // drawing lines; a commented root; a CRLF checkout.
    const vscodeRow =
      "  |--- barwise-vscode           (core, diagram, diagram-ui, llm, code-analysis, dbt, formats, mcp)";
    for (
      const edit of [
        (x) =>
          x.replace(vscodeRow, commented(vscodeRow, "the editor;", "bundles (esbuild) everything")),
        (x) => x.replace(CLAUDE_LLM, "@barwise/llm             (@barwise/core)"),
        (x) => x.replace("|--- barwise-vscode  ", "|--- vscode          "),
        (x) => x.replace(`  |--- ${CLAUDE_LLM}\n`, `  |\n  |--- ${CLAUDE_LLM}\n  |\n`),
        (x) =>
          x.replace(
            "(diagram)  -- React renderer over the",
            "(diagram)  -- renders with @xyflow/react (MIT) over the",
          ),
        (x) =>
          x.replace(
            MCP_ROW,
            commented(
              MCP_ROW,
              "the server;",
              "embedded by barwise-vscode (in-process)",
              "barwise-vscode (and CLI) embed it",
              "registry (FormatDescriptor)",
              "(exercise format) and `barwise tutorial`",
              "-- providers (Anthropic, OpenAI)",
            ),
          ),
        (x) => x.replace(ROOT_ROW, `${ROOT_ROW}  -- the kernel`),
        // A wrapped root comment beside the arrow, a wrap with no `|` under
        // the last row, and a `--` wrap under the row's own `--`.
        (x) =>
          x.replace(
            `${ROOT_ROW}\n  ^\n`,
            `${ROOT_ROW}  -- the kernel;\n  ^${" ".repeat(ROOT_ROW.length + 2)}depends inward\n`,
          ),
        (x) =>
          x.replace(
            vscodeRow,
            `${vscodeRow}  -- the editor;\n${" ".repeat(vscodeRow.length + 5)}bundles everything`,
          ),
        (x) =>
          x.replace(
            MCP_ROW,
            `${MCP_ROW}  -- the server\n  |${" ".repeat(MCP_ROW.length - 1)}-- in-process`,
          ),
        (x) => x.replace(/\n/g, "\r\n"),
        (x) =>
          x
            .replace("connector package: registers\n", "unlike @barwise/formats (which\n")
            .replace("code importers into the", "is pure) code importers"),
      ]
    ) {
      const ok = archPlanted(dir, "CLAUDE.md", edit);
      assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    }
    // A package removed from packages/ while the map and picture keep it.
    rmSync(join(dir, "barwise", "packages", "learn"), { recursive: true });
    const gone = runArch(dir);
    assert.equal(gone.status, 1, gone.stderr);
    assert.match(gone.stderr, /INTENDED has learn, which is not a package under packages\//);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check:architecture reads package CLAUDE.md tables and script literals only where they state the graph", () => {
  const { dir } = architectureRepo();
  const LLM = "barwise/packages/llm/CLAUDE.md";
  try {
    // Not an entry: an array that also holds a non-package, an empty one,
    // and the same shape in a test, whose fixtures state graphs on purpose.
    for (
      const edit of [
        (x) =>
          x.replace(
            "const PACKAGES",
            'const A = { core: ["ajv", "core"], cli: [] };\nconst PACKAGES',
          ),
      ]
    ) {
      const ok = archPlanted(dir, "barwise/scripts/arch-triage.mjs", edit);
      assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    }
    stage(dir, "barwise/scripts/tests/fixture-graph.test.mjs", 'const G = { "cli": ["core"] };\n');
    // An external Upstream row (diagram-ui's react) is ignored; a heading
    // with no table, and an Upstream cell that is no name, are findings.
    const noTable = archPlanted(dir, LLM, (x) => x.replace(/^\| Direction/m, "| Heading"));
    assert.equal(noTable.status, 1, noTable.stderr);
    assert.match(noTable.stderr, /packages\/llm\/CLAUDE\.md: has no "## Dependencies" table/);
    const bad = archPlanted(
      dir,
      LLM,
      (x) => x.replace(/^(\| Upstream\s*\| )`@barwise\/core`/m, "$1core"),
    );
    assert.equal(bad.status, 1, bad.stderr);
    assert.match(bad.stderr, /Upstream row "core" is not a backticked name/);
    // A package CLAUDE.md that cannot be read is a refusal, not "no rows".
    rmSync(join(dir, LLM));
    const gone = runArch(dir);
    assert.equal(gone.status, 2, gone.stdout + gone.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check:architecture cannot answer when an input is unreadable or misshapen", () => {
  const { dir } = architectureRepo();
  const refused = (r, why) => {
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, why);
  };
  const core = /cannot answer -- \S*packages\/core\/package\.json: /;
  try {
    refused(
      archPlanted(dir, "CLAUDE.md", (s) => s.replace("## Dependency Graph", "## Packages")),
      /cannot answer -- CLAUDE\.md has no "## Dependency Graph" heading/,
    );
    // The section keeps its heading and loses its block: it must refuse,
    // not read a later section's fence as the graph.
    refused(
      archPlanted(
        dir,
        "CLAUDE.md",
        (s) => s.replace(/(## Dependency Graph\n\n)```\n[\s\S]*?\n```\n/, "$1"),
      ),
      /the Dependency Graph section has no fenced block/,
    );
    refused(archPlanted(dir, CORE_PKG, (s) => s.replace("{", "{,")), core);
    // Valid JSON of the wrong shape: read on, each would crash with exit 1
    // or skip a field whose keys are array indices.
    refused(archPlanted(dir, CORE_PKG, () => "null\n"), core);
    // The external-deps list, misshapen, is a refusal too.
    // An empty list, one without core, or a name listed twice would check
    // less than it says, so each is refused rather than read as clean.
    for (
      const body of [
        'module.exports = { core: "ajv" };\n',
        "module.exports = {};\n",
        "module.exports = { learn: [] };\n",
        'module.exports = { core: ["ajv", "ajv"] };\n',
      ]
    ) {
      refused(
        archPlanted(dir, EXTERNAL_CJS, () => body),
        /external-deps\.cjs does not export a map of package to dependency list/,
      );
    }
    refused(
      archPlanted(dir, CORE_PKG, (s) => s.replace(`"name": "@barwise/core"`, `"name": 5`)),
      core,
    );
    refused(
      archPlanted(
        dir,
        CORE_PKG,
        (s) =>
          s.replace(
            `"dependencies": {`,
            `"peerDependencies": ["@barwise/cli"],\n  "dependencies": {`,
          ),
      ),
      core,
    );
    // The graph block names no package, or wraps a list onto a second line.
    refused(
      archPlanted(
        dir,
        "CLAUDE.md",
        (s) => s.replace(/(## Dependency Graph\n\n```\n)[\s\S]*?(\n```\n)/, "$1$2"),
      ),
      /the Dependency Graph block names no package/,
    );
    // Every line outside the grammar is refused by name: a wrapped list,
    // a misdrawn or nested connector, a second root, a legend above the
    // root, box-drawing characters, a row with no space before its list.
    const LLM_ROW = `  |--- ${CLAUDE_LLM}`;
    for (
      const [from, to, line] of [
        [
          CLAUDE_LLM,
          "@barwise/llm             (core,\n  |   diagram)",
          /\|--- @barwise\/llm\s+\(core,/,
        ],
        [LLM_ROW, "  |---   (core)", /\|---   \(core\)/],
        [LLM_ROW, "  |---- @barwise/llm      (core)", /\|---- @barwise\/llm/],
        [LLM_ROW, "  +--- @barwise/llm      (core)", /\+--- @barwise\/llm/],
        [LLM_ROW, `  |     |--- ${CLAUDE_LLM}`, /\|     \|--- @barwise\/llm/],
        [LLM_ROW, "  \u251c\u2500\u2500 @barwise/llm (core)", /\u251c\u2500\u2500 @barwise\/llm/],
        [LLM_ROW, "  |--- @barwise/llm(core)", /\|--- @barwise\/llm\(core\)/],
        [LLM_ROW, `${LLM_ROW} extra`, /\(core\) extra/],
        [LLM_ROW, "  |---------- connectors ----------", /\|---------- connectors/],
        [LLM_ROW, `${LLM_ROW}\n\n@barwise/planned            (core)`, /@barwise\/planned/],
        // Comment text only continues a row that opened a comment: under a
        // row without one it is a wrapped list or a lost connector.
        [LLM_ROW, `${LLM_ROW}\n  |                              (mcp)`, /\(mcp\)/],
        [LLM_ROW, `${LLM_ROW}\n  |   barwise-planned       (core)  (planned)`, /barwise-planned/],
        [LLM_ROW, `${LLM_ROW}\n  |   planned(core)`, /planned\(core\)/],
        [LLM_ROW, `${LLM_ROW}\n  |   a stray note`, /a stray note/],
        // Under a commented row, text at any other column is not its comment:
        // a lost row, a list, or prose one column off.
        [
          MCP_ROW,
          `${MCP_ROW}  -- the server\n  |   barwise-planned (core)`,
          /\|   barwise-planned/,
        ],
        [MCP_ROW, `${MCP_ROW}  -- the server\n  |   (core, llm)`, /\|   \(core, llm\)/],
        [MCP_ROW, `${MCP_ROW}  -- the server\n  |   planned(core)`, /\|   planned\(core\)/],
        [
          MCP_ROW,
          `${MCP_ROW}  -- the server\n  |   planned (core)  --planned`,
          /\|   planned \(core\)/,
        ],
        [
          MCP_ROW,
          `${commented(MCP_ROW, "the server")}\n  |${
            " ".repeat(MCP_ROW.indexOf("(") - 3)
          }at the list column`,
          /at the list column/,
        ],
        [
          MCP_ROW,
          `${MCP_ROW}  -- the server\n  |   lost (core)`,
          new RegExp(
            `under @barwise/mcp must start right of column ${
              MCP_ROW.indexOf("(") + 1
            }, and this one starts at column 7`,
          ),
        ],
        // A drawing line ends the comment: text after it continues nothing.
        // ... even one padded with trailing spaces past the list column.
        [
          MCP_ROW,
          `${commented(MCP_ROW, "the server")}\n  |${" ".repeat(MCP_ROW.length)}\n  |${
            " ".repeat(MCP_ROW.length + 2)
          }after padding`,
          /after padding/,
        ],
        [
          MCP_ROW,
          `${commented(MCP_ROW, "the server")}\n  |\n  |${
            " ".repeat(MCP_ROW.length + 2)
          }after a gap`,
          /after a gap/,
        ],
        [MCP_ROW, `${MCP_ROW}  -- the server\n  |\n  |   a stray note`, /a stray note/],
        // A row that lost its connector, in any spelling, is not prose.
        [LLM_ROW, `${LLM_ROW}\n  |   @barwise/planned   (core)`, /\|   @barwise\/planned/],
        [LLM_ROW, `${LLM_ROW}\n  @barwise/planned   (core)`, /"  @barwise\/planned/],
        [LLM_ROW, `${LLM_ROW}\n  |   barwise-planned (core)`, /\|   barwise-planned/],
        [LLM_ROW, `${LLM_ROW}\n  |   @xyflow/react (MIT) is not used here`, /@xyflow\/react/],
        [LLM_ROW, "  '--- @barwise/llm   (core)", /'--- @barwise\/llm/],
        [LLM_ROW, "  ^--- @barwise/llm   (core)", /\^--- @barwise\/llm/],
        [LLM_ROW, `        |--- ${CLAUDE_LLM}`, /\|--- @barwise\/llm/],
        // A name or list the grammar cannot read.
        [LLM_ROW, "  |--- `@barwise/llm`   (core)", /\|--- `@barwise\/llm`/],
        [LLM_ROW, "  |--- @barwise/llm   (core; diagram)", /\(core; diagram\)/],
      ]
    ) {
      const r = archPlanted(dir, "CLAUDE.md", (s) => s.replace(from, to));
      refused(r, /the graph block line ".*" is not one the grammar allows/);
      assert.match(r.stderr, line);
    }
    // A malformed row after a commented row is not blamed on that comment.
    const dash = archPlanted(
      dir,
      "CLAUDE.md",
      (s) =>
        s.replace(
          "(core, formats)  -- connector package:\n  |                                        registers the dbt",
          "(core, formats)  \u2014 connector package:\n  |                                        registers the dbt",
        ),
    );
    refused(dash, /\(core, formats\)  \u2014 connector package/);
    assert.doesNotMatch(dash.stderr, /must start right of column/);
    // Nor is a misdrawn or nested connector there.
    for (
      const bad of [
        "        |--- @barwise/llm (core)",
        "  |     |--- @barwise/llm (core)",
        "  +--- @barwise/llm (core)",
      ]
    ) {
      const r = archPlanted(dir, "CLAUDE.md", (s) => s.replace(`  |--- ${CLAUDE_LLM}`, bad));
      refused(r, /is not one the grammar allows/);
      assert.doesNotMatch(r.stderr, /must start right of column/, bad);
    }
    refused(
      archPlanted(
        dir,
        "CLAUDE.md",
        (s) => s.replace(ROOT_ROW, `Legend: an arrow (^) points at a dependency\n${ROOT_ROW}`),
      ),
      /the graph block must open with the root line, not "Legend/,
    );
    // A legend shaped like a root row (`Legend (x)`) is taken for the root,
    // and the real root line is then refused: exit 2 either way, never
    // compared.
    refused(
      archPlanted(dir, "CLAUDE.md", (s) => s.replace(ROOT_ROW, `Legend (arrows)\n${ROOT_ROW}`)),
      /the graph block line "@barwise\/core\s+\(no internal deps\)" is not one the grammar/,
    );
    const shapeFault = /does not export a map of package to package list/;
    for (const bad of [`"core": [[]]`, `"core": "none"`]) {
      refused(archPlanted(dir, INTENDED_CJS, (s) => s.replace(`"core": []`, bad)), shapeFault);
    }
    refused(archPlanted(dir, INTENDED_CJS, () => "module.exports = {};\n"), shapeFault);
    // Two manifests with one name: the name maps to neither directory.
    const copyDir = join(dir, "barwise", "packages", "core-old");
    mkdirSync(copyDir);
    writeFileSync(join(copyDir, "package.json"), readFileSync(join(dir, CORE_PKG), "utf8"));
    refused(
      runArch(dir),
      /two package manifests are named @barwise\/core/,
    );
    rmSync(copyDir, { recursive: true });
    // A directory with no manifest is not a package, and no manifest at
    // all is nothing to compare.
    mkdirSync(join(dir, "barwise", "packages", "stray-build"));
    const stray = runArch(dir);
    assert.equal(stray.status, 0, stray.stdout + stray.stderr);
    const empty = mkdtempSync(join(tmpdir(), "barwise-arch-empty-"));
    try {
      mkdirSync(join(empty, "barwise", "scripts", "lib"), { recursive: true });
      mkdirSync(join(empty, "barwise", "packages", "core"), { recursive: true });
      writeFileSync(join(empty, "CLAUDE.md"), readFileSync(join(dir, "CLAUDE.md")));
      writeFileSync(join(empty, INTENDED_CJS), readFileSync(join(dir, INTENDED_CJS)));
      refused(
        runArch(dir, [ARCH_CMD[1], "--root", empty]),
        /no package\.json under/,
      );
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
    refused(
      runArch(dir, [ARCH_CMD[1], "--root"]),
      /--root needs a value/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
