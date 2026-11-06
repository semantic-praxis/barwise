/**
 * check:pins (docs/specs/runtime-pins-check.spec.md, WS1). The rules are
 * planted red against small inputs; the gate runs over a throwaway tree
 * with a stand-in `uv` on a PATH that holds nothing else, so a real uv
 * cannot answer for it, and its refusals are exit 2, never a pass.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  hookReadsNvmrc,
  installerVersion,
  pythonPinProblem,
  runningProblem,
  uvVersionProblem,
  workflowFindings,
} from "../check-pins.mjs";

const GATE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "check-pins.mjs");
const NODE = process.version.replace(/^v/, "");
const setup = (w) => ({ jobs: { build: { steps: [{ uses: "actions/setup-node@v7", with: w }] } } });

test("a workflow naming a Node version, or not reading .nvmrc, is a finding [adr:pinned-runtimes#node-from-nvmrc]", () => {
  assert.deepEqual(workflowFindings([["ok.yml", setup({ "node-version-file": ".nvmrc" })]]), []);
  assert.match(
    workflowFindings([["a.yml", setup({ "node-version": "26" })]]).join("\n"),
    /sets node-version/,
  );
  assert.match(
    workflowFindings([["b.yml", setup({ "node-version-file": "package.json" })]]).join("\n"),
    /does not read node-version-file: \.nvmrc/,
  );
  assert.deepEqual(
    workflowFindings([["c.yml", { jobs: { x: { steps: [{ run: "npm ci" }] } } }]]),
    [],
  );
});

test("a .python-version names a minor only [adr:pinned-runtimes#python-minor]", () => {
  assert.equal(pythonPinProblem("3.13\n"), null);
  assert.match(pythonPinProblem("3.13.12\n"), /not a minor/);
  assert.match(pythonPinProblem(">=3.13\n"), /not a minor/);
});

test("another Node major or minor, or another Python minor, is a refusal; a Node patch is not [adr:pinned-runtimes#verify-running]", () => {
  const base = { nvmrc: "26.7.0\n", node: "v26.7.0", pin: "3.13\n", python: "3.13.17" };
  assert.equal(runningProblem(base), null);
  assert.equal(
    runningProblem({ ...base, node: "v26.7.3" }),
    null,
    "a patch is printed, not refused",
  );
  assert.equal(
    runningProblem({ ...base, nvmrc: "v26.7.0\n" }),
    null,
    "a leading v in .nvmrc reads the same",
  );
  assert.match(runningProblem({ ...base, node: "v26.1.0" }), /another major or minor/);
  assert.match(runningProblem({ ...base, node: "v24.11.0" }), /another major or minor/);
  assert.match(
    runningProblem({ ...base, python: "3.12.3" }),
    /another minor than barwise\/\.python-version/,
  );
  assert.match(runningProblem({ ...base, python: "" }), /no Python version/);
  assert.equal(
    runningProblem({ ...base, pin: undefined, python: null }),
    null,
    "with no usable pin, only Node is read",
  );
});

test("a hook reads .nvmrc only where code names it, not in a comment or an echoed message", () => {
  assert.ok(hookReadsNvmrc('node_want="$(tr -d \'[:space:]\' <"${DIR}/.nvmrc")"'));
  assert.ok(!hookReadsNvmrc("# reads .nvmrc\nnvm install 26"));
  assert.ok(!hookReadsNvmrc("nvm install 26  # was .nvmrc"));
  assert.ok(!hookReadsNvmrc('echo "ignoring .nvmrc"'));
});

test("the uv that runs is held to install-uv.sh's VERSION [adr:python-from-the-lockfile#uv-bootstrap]", () => {
  assert.equal(installerVersion('set -e\nVERSION="0.12.7"\n'), "0.12.7");
  assert.throws(() => installerVersion("VERSION=0.12.7\n"), /no VERSION="\.\.\." line/);
  const pinned = "0.12.7";
  assert.equal(
    uvVersionProblem({ pinned, reported: "uv 0.12.7 (x86_64-unknown-linux-gnu)\n" }),
    null,
  );
  assert.equal(uvVersionProblem({ pinned, reported: "uv 0.12.7" }), null);
  assert.match(
    uvVersionProblem({ pinned, reported: "uv 0.11.32 (x86_64-unknown-linux-gnu)" }),
    /uv 0\.11\.32 is running, not scripts\/install-uv\.sh's 0\.12\.7; run `bash barwise\/scripts\/install-uv\.sh/,
  );
  assert.match(uvVersionProblem({ pinned, reported: "uv 0.12.70" }), /uv 0\.12\.70 is running/);
  assert.match(uvVersionProblem({ pinned, reported: "garbage" }), /"garbage" is running/);
});

/**
 * A tree holding what the gate reads, and a stand-in uv answering
 * `--version` with `uvVersion` (as the real one does: "uv 0.12.7 (target)")
 * and `python find` with `uv`. `installer` is install-uv.sh's text, or
 * null for none.
 */
function tree(
  t,
  {
    workflow = "node-version-file: .nvmrc",
    hook = 'tr -d "[:space:]" < .nvmrc',
    pin = "3.13",
    copy = "3.13",
    uv = "3.13.4",
    uvVersion = "0.12.7",
    installer = 'set -euo pipefail\nVERSION="0.12.7"\n',
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "barwise-pins-"));
  const bin = mkdtempSync(join(tmpdir(), "barwise-pins-bin-"));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  });
  writeFileSync(join(dir, ".nvmrc"), `${NODE}\n`);
  writeFileSync(join(dir, ".python-version"), `${pin}\n`);
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(
    join(dir, ".github", "workflows", "ci.yml"),
    `jobs:\n  ci:\n    steps:\n      - uses: actions/setup-node@v7\n        with:\n          ${workflow}\n`,
  );
  mkdirSync(join(dir, ".claude", "hooks"), { recursive: true });
  writeFileSync(join(dir, ".claude", "hooks", "session-start.sh"), `#!/bin/sh\n${hook}\n`);
  mkdirSync(join(dir, "barwise"));
  if (copy !== null) writeFileSync(join(dir, "barwise", ".python-version"), `${copy}\n`);
  if (installer !== null) {
    mkdirSync(join(dir, "barwise", "scripts"));
    writeFileSync(join(dir, "barwise", "scripts", "install-uv.sh"), installer);
  }
  if (uv !== null) {
    writeFileSync(
      join(bin, "uv"),
      `#!/bin/sh
if [ "$1" = --version ]; then echo "uv ${uvVersion} (x86_64-unknown-linux-gnu)"; exit 0; fi
printf '%s\\n' "$@" > "${bin}/uv-argv"
echo ${uv}
`,
    );
    chmodSync(join(bin, "uv"), 0o755);
  }
  return { dir, bin };
}

function run({ dir, bin }) {
  return spawnSync(process.execPath, [GATE, "--root", join(dir, "barwise")], {
    encoding: "utf8",
    env: { ...process.env, PATH: bin },
  });
}

test("the gate passes a tree whose pins are read, and prints the versions that ran", (t) => {
  const tr = tree(t);
  const r = run(tr);
  assert.equal(r.status, 0, r.stderr);
  // `uv python find` on the absolute project path: never `uv run`, which
  // would sync the project and could rebuild a venv.
  assert.deepEqual(readFileSync(join(tr.bin, "uv-argv"), "utf8").trim().split("\n"), [
    "python",
    "find",
    "--show-version",
    "--project",
    join(tr.dir, "barwise"),
  ]);
  assert.match(r.stderr, new RegExp(`ran Node ${process.version} .*Python 3\\.13\\.4`));
  assert.match(r.stderr, /uv 0\.12\.7 \(x86_64-unknown-linux-gnu\)\. OK/);
});

test("the gate refuses a uv on another version than install-uv.sh's, naming both [adr:python-from-the-lockfile#uv-bootstrap]", (t) => {
  const r = run(tree(t, { uvVersion: "0.11.32" }));
  assert.equal(r.status, 2, r.stderr);
  assert.match(
    r.stderr,
    /cannot answer: uv 0\.11\.32 is running, not scripts\/install-uv\.sh's 0\.12\.7; run `bash barwise\/scripts\/install-uv\.sh ~\/\.local\/bin`/,
  );
  assert.doesNotMatch(r.stderr, /OK/);
});

test("the gate refuses when install-uv.sh, or its VERSION line, is missing", (t) => {
  const gone = run(tree(t, { installer: null }));
  assert.equal(gone.status, 2, gone.stderr);
  assert.match(gone.stderr, /cannot answer: scripts\/install-uv\.sh is missing/);
  const noLine = run(tree(t, { installer: "set -euo pipefail\nV=0.12.7\n" }));
  assert.equal(noLine.status, 2, noLine.stderr);
  assert.match(noLine.stderr, /cannot answer: scripts\/install-uv\.sh has no VERSION/);
});

test("the gate: a workflow naming a Node version fails [adr:pinned-runtimes#node-from-nvmrc]", (t) => {
  const r = run(tree(t, { workflow: "node-version: 26" }));
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /sets node-version/);
});

test("the gate: a session hook that stops reading .nvmrc fails", (t) => {
  const r = run(tree(t, { hook: "# reads .nvmrc in a comment only\nnvm install 26" }));
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /does not read \.nvmrc/);
});

test("the gate: no pin beside pyproject.toml, or a patch-level pin, fails [adr:pinned-runtimes#python-minor]", (t) => {
  const missing = run(tree(t, { copy: null }));
  assert.equal(missing.status, 1, missing.stderr);
  assert.match(
    missing.stderr,
    /barwise\/\.python-version is missing; uv reads the pin only beside pyproject\.toml/,
  );
  const patch = run(tree(t, { copy: "3.13.12" }));
  assert.equal(patch.status, 1, patch.stderr);
  assert.match(patch.stderr, /names "3\.13\.12", not a minor/);
});

test("the gate refuses when uv resolves another minor, and when uv is absent [adr:pinned-runtimes#verify-running]", (t) => {
  const other = tree(t, { uv: "3.12.3" });
  const r = run(other);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /cannot answer: uv resolves Python 3\.12\.3 .*another minor/);
  const absent = run(tree(t, { uv: null }));
  assert.equal(absent.status, 2, absent.stderr);
  assert.match(absent.stderr, /cannot answer: uv could not be run/);
  assert.doesNotMatch(absent.stderr, /OK/);
});

test("the gate: a deleted session hook is a finding, and an unreadable pin a refusal", (t) => {
  const tr = tree(t);
  rmSync(join(tr.dir, ".claude", "hooks", "session-start.sh"));
  const gone = run(tr);
  assert.equal(gone.status, 1, gone.stderr);
  assert.match(gone.stderr, /session-start\.sh is missing/);
  const dir = tree(t);
  rmSync(join(dir.dir, "barwise", ".python-version"));
  mkdirSync(join(dir.dir, "barwise", ".python-version"));
  const odd = run(dir);
  assert.equal(odd.status, 2, odd.stderr);
  assert.match(odd.stderr, /cannot answer/);
});

test("a finding outranks a refusal", (t) => {
  const r = run(tree(t, { workflow: "node-version: 26", uv: null }));
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /also could not vouch for the runtimes/);
});
