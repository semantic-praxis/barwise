/**
 * Shared helpers for the gate tests, the gates-*.test.mjs files. Those were
 * one file, gates.test.mjs, until barwise-bbt split it so its tests run in
 * parallel; this header was that file's, and still says why they exist.
 *
 * Tests for the gate scripts themselves.
 *
 * These exist because of two findings that a passing gate could not have
 * revealed, and that reading the gate could not either:
 *
 *   barwise-905  `check-no-nul` scanned 1426 of 1483 tracked files under
 *                `npm run` and 1483 by hand, printing `OK` both times.
 *                `git ls-files` resolves relative to the process cwd and
 *                the npm script runs from `barwise/`, so every tracked
 *                file outside `barwise/` went unscanned by the gate whose
 *                whole purpose is "no NUL byte anywhere". `check-shell`
 *                had the same hole, 6 files against 7. The COUNT is the
 *                only tell; a gate with half the coverage still says OK.
 *
 *   barwise-906  Three verifications in one session came back green for
 *                reasons unrelated to what they tested. The worst was a
 *                NUL probe written as an UNTRACKED file: the gate
 *                enumerates through `git ls-files`, never saw the probe,
 *                and reported OK. The defect and the check were in
 *                different worlds, so the green said nothing at all.
 *
 * So every gate here is shown RED on a defect placed where that gate
 * actually looks, and GREEN without it -- the red reading established
 * first, in a throwaway repo rather than by staging into this one.
 *
 * `node:test` rather than vitest: these are plain `.mjs` with nothing to
 * compile, and vitest is a dependency of the packages, not of this level.
 * Adding one to run four tests would be the kind of dependency CLAUDE.md
 * tells us not to take.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decisionIds, parseEnforcedBy } from "../lib/adr-enforcement.mjs";
import { isAdr } from "../lib/architecture-section.mjs";

export const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: SCRIPTS,
  encoding: "utf8",
}).trim();

// Written as an escape, never as a literal byte. `check-no-nul` scans
// every tracked text file in this repo -- including this one -- so a
// real NUL here would make the gate's own test fail the gate.
export const NUL = "\u0000";

/** Run a gate with an explicit cwd. No shell, and no pipeline to read through. */
export function gate(script, cwd, ...args) {
  return spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
    cwd,
    encoding: "utf8",
  });
}

/**
 * Run a gate with `git` replaced by a stub, to test the refusal path.
 *
 * `mode` is "empty" (git exits 0 printing nothing) or "fail" (git exits
 * 127). The empty case is the one worth having: a failing git throws
 * out of execFileSync and is at least loud, while a SUCCEEDING git that
 * prints nothing yields `REPO_ROOT === ""`, and `resolve("", file)`
 * silently means cwd. That is the reading that looks like an answer.
 */
export function gateWithStubGit(script, mode, ...args) {
  const dir = mkdtempSync(join(tmpdir(), "barwise-nogit-"));
  try {
    const stub = join(dir, "git");
    writeFileSync(stub, mode === "empty" ? "#!/bin/sh\nexit 0\n" : "#!/bin/sh\nexit 127\n");
    chmodSync(stub, 0o755);
    return spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Skip a case that runs a history-reading gate (audit-spec-status) against
 * this repository when the clone is shallow: the gate refuses there, by
 * design, so the case cannot ask its question. Six such cases failed
 * instead of skipping under the fault matrix's git-shallow axis, which a
 * real shallow clone would reproduce (gate-contract-enforced WS1). Read
 * lazily, so a broken git fails the case that asked, not the module.
 * Returns true when it skipped.
 */
let shallowClone;
export function skipIfShallow(t) {
  shallowClone ??= execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
    cwd: REPO,
    encoding: "utf8",
  }).trim() === "true";
  if (shallowClone) t.skip("shallow clone: run `git fetch --unshallow` to exercise this gate");
  return shallowClone;
}

/**
 * A case that needs a built `dist` (the rubric ratchet scores through
 * promptlab's). Absent, or present and not loadable (`out`, the output of
 * a run that tried), it skips on a developer's machine and THROWS when `CI`
 * is set: test:scripts runs after `npm run build` in ci.yml, so a missing
 * dist there is a broken step order, and a skip would report a pass for a
 * case that never ran (barwise-ym8.fi5). Returns true when it skipped.
 */
export function needDist(t, rel, out) {
  const absent = !existsSync(join(REPO, "barwise", rel));
  const unloadable = out !== undefined && /dist not found|Cannot find module/.test(out);
  if (!absent && !unloadable) return false;
  const why = absent
    ? `${rel} is not built`
    : `the build at ${rel} does not load`;
  // `CI=0` and `CI=false` are a developer saying "not CI"; GitHub sets `true`.
  if (![undefined, "", "0", "false"].includes(process.env.CI)) {
    throw new Error(`${why}, and CI is set: run npm run build before test:scripts (ci.yml order)`);
  }
  t.skip(`${why}; run npm run build first`);
  return true;
}

/** A throwaway git repo, so a planted defect never touches this one's index. */
export function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "barwise-gate-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "gate@test"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "gate"], { cwd: dir });
  return dir;
}

export function stage(dir, name, contents) {
  const path = join(dir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  execFileSync("git", ["add", "--", name], { cwd: dir });
}

/**
 * A gate that REFUSED did not fail, and a test that reads the two the same
 * way is the defect the refusal contract exists to prevent, one level up.
 *
 * `check-shell` needs shellcheck and `check-secrets` needs gitleaks. Neither
 * is installed in a fresh remote container, both correctly exit 2 saying they
 * cannot answer -- and eight tests here asserted exit 0 or 1, so `ci:local`
 * went red on a missing tool with the same reading it gives for a real
 * finding (barwise-1012). Worse, it made every `npm run mutate` against this
 * file report CAUGHT unconditionally: the command already failed without any
 * mutation, and CAUGHT is decided from the command's status alone.
 *
 * The skip is `every`, not `some`, and that is the whole distinction -- the
 * same one `audit-gate`'s test above spells out. With the tool absent every
 * run refuses together; a PARTIAL refusal is not an environment fact, it is
 * the defect, and it must still fail here.
 */
export function skippedForMissingTool(t, runs, tool) {
  const rs = Array.isArray(runs) ? runs : [runs];
  if (rs.length > 0 && rs.every((r) => r.status === 2)) {
    t.skip(`${tool} is not installed (exit 2 from every run is refusal, not failure)`);
    return true;
  }
  return false;
}

export const CWDS = [REPO, join(REPO, "barwise"), join(REPO, "barwise", "packages", "core", "src")];

/**
 * Run `mutate.mjs` inside a throwaway repo. The helper resolves --file
 * against `git rev-parse --show-toplevel`, so the temp repo IS the repo
 * root as far as it is concerned, and this repo's tree is never touched.
 */
export function mutate(dir, args) {
  return spawnSync(process.execPath, [join(SCRIPTS, "mutate.mjs"), ...args], {
    cwd: dir,
    encoding: "utf8",
  });
}

/**
 * A committed copy of every input check:architecture reads, from this
 * repo's real files -- all the package manifests, not a sample -- so the
 * test proves the real graph passes before each mutation proves a planted
 * disagreement is seen. Returns the directory and how many manifests it
 * copied, so no count is restated here.
 */
export function architectureRepo() {
  const dir = tempRepo();
  const copy = (rel) => stage(dir, rel, readFileSync(join(REPO, rel), "utf8"));
  copy("CLAUDE.md");
  copy("barwise/scripts/lib/intended.cjs");
  copy(EXTERNAL_CJS);
  copy("barwise/docs/ARCHITECTURE.md");
  // The tracked ADRs only: the copied ARCHITECTURE.md indexes those, and
  // an untracked draft in this checkout would otherwise read as "stale".
  const adrList = execFileSync("git", ["ls-files", "-z", "barwise/docs/adr/"], {
    cwd: REPO,
    encoding: "utf8",
  });
  // An ADR that declares Enforced-by: names gates, tests and issues whose
  // inputs (ci.yml, the root scripts, the live tracker) this fixture does
  // not carry. Its header is rewritten to declare every decision tested,
  // which check:architecture answers from no input at all, so graph and
  // shape cases keep testing what they test and never depend on the live
  // tracker or ci.yml; the enforcement cases build their own inputs
  // (executable-adrs.spec.md, WS3). One fixture gap issue for every
  // decision would break the one-decision-per-gap-issue rule
  // (enforceable-adr-practice.spec.md, WS3).
  let decisions = 0;
  // ADRs as the gate lists them (isAdr): the governance schema beside them
  // is a gate input, not an ADR (adr-conformance-model.spec.md, WS3).
  for (const rel of adrList.split("\0").filter(Boolean).filter(isAdr)) {
    const text = readFileSync(join(REPO, rel), "utf8");
    assert.ok(parseEnforcedBy(text).present, `${rel}: has no Enforced-by: header to rewrite`);
    const ids = decisionIds(text).decisions.map((d) => d.id);
    // Counted as the judge counts: unique ids, a malformed one left out.
    decisions += new Set(ids.filter(Boolean)).size;
    // Enforced-by: is the last header field (check:architecture holds it to
    // that, and requires it), so it runs to the blank line.
    const value = `Enforced-by: tests (${ids.join(", ")})\n`;
    const rewritten = text.replace(/^Enforced-by:[^]*?\n(?=\n)/m, value);
    assert.notEqual(rewritten, text, `${rel}: its Enforced-by: header was not rewritten`);
    stage(dir, rel, rewritten);
  }
  let manifests = 0;
  for (const pkg of readdirSync(join(REPO, "barwise", "packages"))) {
    const rel = `barwise/packages/${pkg}/package.json`;
    if (existsSync(join(REPO, rel))) {
      copy(rel);
      manifests += 1;
      copy(`barwise/packages/${pkg}/CLAUDE.md`);
    }
  }
  // What the graph-copy and core-import scans read: the scripts that could
  // keep a copy of the graph (the tests excepted, as the gate excepts
  // them) and core's source. Written in bulk and added once: it is some
  // two hundred files.
  const tracked = execFileSync("git", [
    "ls-files",
    "-z",
    "barwise/scripts/",
    "barwise/packages/core/src/",
  ], {
    cwd: REPO,
    encoding: "utf8",
  }).split("\0").filter((f) =>
    f !== "" && !f.startsWith("barwise/scripts/tests/")
    && (f.startsWith("barwise/packages/core/src/") || /\.(mjs|cjs|js)$/.test(f))
  );
  for (const rel of tracked) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), readFileSync(join(REPO, rel)));
  }
  execFileSync("git", ["add", "--", ...tracked], { cwd: dir });
  // The rewritten headers render differently in the index, so the copied
  // section is regenerated from them, as stageAdr() does for one ADR.
  {
    const r = spawnSync(
      process.execPath,
      [join(SCRIPTS, "regen-architecture.mjs"), "--root", dir],
      {
        encoding: "utf8",
      },
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    stage(
      dir,
      "barwise/docs/ARCHITECTURE.md",
      readFileSync(join(dir, "barwise/docs/ARCHITECTURE.md"), "utf8"),
    );
  }
  execFileSync("git", ["commit", "-qm", "inputs"], { cwd: dir });
  return { dir, manifests, decisions };
}

export const ARCH_CMD = [process.execPath, join(SCRIPTS, "check-architecture.mjs"), "--root", "."];
export const ARCH = ["--", ...ARCH_CMD];
/** Run check:architecture over the fixture in `dir`, or with other arguments. */
export const runArch = (dir, args = ARCH_CMD.slice(1)) =>
  spawnSync(ARCH_CMD[0], args, { cwd: dir, encoding: "utf8" });

/** Run check:architecture in `dir` with one file edited, then restore it. */
export function archPlanted(dir, rel, edit) {
  const path = join(dir, rel);
  const before = readFileSync(path, "utf8");
  const after = edit(before);
  assert.notEqual(after, before, `${rel}: the edit did not apply`);
  writeFileSync(path, after);
  try {
    return runArch(dir);
  } finally {
    writeFileSync(path, before);
  }
}

export const CLAUDE_LLM = "@barwise/llm             (core)";
export const ROOT_ROW = "@barwise/core               (no internal deps)";

/** `row` with a comment, wrapped onto `more` lines at the comment text's column. */
export function commented(row, comment, ...more) {
  const col = row.length + 5;
  return [`${row}  -- ${comment}`, ...more.map((t) => `  |${" ".repeat(col - 3)}${t}`)].join("\n");
}
export const MCP_ROW =
  "  |--- @barwise/mcp             (core, diagram, diagram-ui, llm, code-analysis, dbt, formats, learn)";
export const CORE_PKG = "barwise/packages/core/package.json";
export const INTENDED_CJS = "barwise/scripts/lib/intended.cjs";
export const EXTERNAL_CJS = "barwise/scripts/lib/external-deps.cjs";
