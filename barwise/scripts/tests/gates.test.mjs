/**
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
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: SCRIPTS,
  encoding: "utf8",
}).trim();

// Written as an escape, never as a literal byte. `check-no-nul` scans
// every tracked text file in this repo -- including this one -- so a
// real NUL here would make the gate's own test fail the gate.
const NUL = "\u0000";

/** Run a gate with an explicit cwd. No shell, and no pipeline to read through. */
function gate(script, cwd, ...args) {
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
function gateWithStubGit(script, mode, ...args) {
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

// --- barwise-989: a gate that cannot see its input must not print PASS ---

/**
 * Every gate that resolves the repo root through `lib/tracked.mjs`, plus
 * the two that used to re-derive it themselves.
 *
 * Before this, all seven exited 1 with a Node stack trace -- a path
 * built from `""`, not a guard that noticed. A stack trace reads as a
 * defect in the gate, which sends the reader hunting something that is
 * not there; exit 2 says "could not answer" and is the third result the
 * contract exists to give (docs/specs/gate-refusal-contract.spec.md).
 */
const ROOT_DEPENDENT_GATES = [
  "check-no-nul.mjs",
  "check-python-uv.mjs",
  "check-book-citations.mjs",
  "check-core-purity.mjs",
  "check-file-size.mjs",
  "check-secrets.mjs",
  "audit-corrections.mjs",
];

for (const script of ROOT_DEPENDENT_GATES) {
  for (const mode of ["empty", "fail"]) {
    test(`${script} refuses with exit 2 when git ${mode === "empty" ? "answers emptily" : "fails"}`, () => {
      const r = gateWithStubGit(script, mode);
      assert.equal(
        r.status,
        2,
        `expected refusal (2), got ${r.status}:\n${r.stdout}${r.stderr}`,
      );
      assert.match(r.stderr, /repository root is unknown/);
      // The point of the contract: never a stack trace, never a PASS.
      assert.doesNotMatch(r.stderr, /at .*\.mjs:\d+/);
      assert.doesNotMatch(r.stdout, /OK|PASS/);
    });
  }
}

test("trackedFiles refuses rather than reporting OK over an empty listing", () => {
  // git ls-files returning nothing is barwise-905's shape: every caller
  // filters the list and reports OK on finding no offenders, so an empty
  // listing is exactly the reading that looks like success. The stub
  // answers every git call, so `rev-parse` refuses first -- which is the
  // correct order and is why this asserts the contract rather than the
  // specific message.
  const r = gateWithStubGit("check-no-nul.mjs", "empty");
  assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stdout, /tracked files/);
});

// --- barwise-990: fmt:check reported OK over a set it could not see ---

/**
 * `dprint.json` lives in `barwise/` and `npm run fmt` runs from there,
 * so dprint never walked up: README.md, CLAUDE.md, AGENTS.md and every
 * `.claude/skills/*.md` were outside its reach and had never been
 * formatted, while `fmt:check` exited 0. barwise-905's shape applied to
 * formatting, and the three files it missed are the three a new
 * contributor reads first.
 */
test("fmt-root covers the files outside barwise/, from every cwd", () => {
  const runs = CWDS.map((cwd) => ({ cwd, ...gate("fmt-root.mjs", cwd, "--check") }));
  for (const r of runs) {
    assert.equal(r.status, 0, `fmt-root failed in ${r.cwd}:\n${r.stdout}${r.stderr}`);
  }
  // The COUNT is the tell, exactly as it was for check-no-nul: a run
  // that formatted nothing also exits 0 and also prints OK.
  const counts = new Set(runs.map((r) => /(\d+) file\(s\)/.exec(r.stdout)?.[1]));
  assert.equal(counts.size, 1, `fmt-root's coverage depends on cwd: ${[...counts].join(", ")}`);
  assert.ok(Number([...counts][0]) > 0, "fmt-root reported zero files, which cannot be right");
});

test("fmt-root refuses when git cannot say where the repository is", () => {
  // Named for what it actually reaches. An earlier version of this test
  // was called "refuses over an empty file set" and did NOT test that:
  // with the stub answering every git call, REPO_ROOT refuses before
  // `targets` is ever computed, so fmt-root's own `targets.length === 0`
  // guard is never entered. `npm run mutate` disabling that guard came
  // back UNCAUGHT, which is how the mislabelling was found -- a test
  // named after a guard it does not exercise is the same defect as a
  // guard that cannot fire.
  //
  // fmt-root's own empty-set guard is covered instead by mutating the
  // `!f.startsWith("barwise/")` filter, which is the only way to reach
  // it: trackedFiles() refuses on an empty listing first.
  const r = gateWithStubGit("fmt-root.mjs", "empty", "--check");
  assert.equal(r.status, 2, `expected refusal, got ${r.status}:\n${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stdout, /OK/);
});

/** A throwaway git repo, so a planted defect never touches this one's index. */
function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "barwise-gate-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "gate@test"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "gate"], { cwd: dir });
  return dir;
}

function stage(dir, name, contents) {
  const path = join(dir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  execFileSync("git", ["add", "--", name], { cwd: dir });
}

// --- barwise-905: coverage must not depend on where the gate is invoked ---

const CWDS = [REPO, join(REPO, "barwise"), join(REPO, "barwise", "packages", "core", "src")];

// `check-secrets` has the same property but is asserted separately, below:
// its history mode depends on clone depth, so the invariance test uses
// `--staged` and cannot share this loop's argument-free call.
for (const script of ["check-no-nul.mjs", "check-shell.mjs", "audit-corrections.mjs"]) {
  test(`${script} reports the same coverage from every cwd`, () => {
    const runs = CWDS.map((cwd) => ({ cwd, ...gate(script, cwd) }));
    for (const r of runs) {
      assert.equal(r.status, 0, `${script} failed in ${r.cwd}:\n${r.stdout}${r.stderr}`);
    }
    const outputs = new Set(runs.map((r) => r.stdout.trim()));
    assert.equal(
      outputs.size,
      1,
      `${script} coverage depends on cwd:\n${
        runs.map((r) => `  ${r.cwd}\n    ${r.stdout.trim()}`).join("\n")
      }`,
    );
  });
}

/**
 * `audit-gate` is the same property, and it is here because it broke.
 *
 * It spawned `npm audit` with no `cwd`, so from a workspace package it
 * audited that package -- no lockfile of its own, therefore no
 * advisories, therefore `PASS`. It did not merely under-report: with the
 * advisory invisible, its ACCEPTED entry looked stale and the gate
 * advised deleting the acceptance record for a live high-severity RCE
 * (barwise-987, docs/specs/gate-refusal-contract.spec.md).
 *
 * Separate from the loop above because the gate reaches the network,
 * which the other two do not: an environment that cannot run `npm audit`
 * must skip loudly rather than read as a cwd defect. That is the
 * `audit-spec-status` shallow-clone pattern, for the same reason.
 *
 * The skip is `every`, not `some`, and that distinction is the whole
 * test. Written with `some`, this passed with the defect restored: from
 * the repo root the un-pinned spawn made `npm audit` report ENOLOCK, the
 * gate refused with exit 2, and the skip guard read that as "this
 * environment cannot audit" and reported green. The guard added for
 * robustness became the thing hiding the defect -- caught by `npm run
 * mutate` returning UNCAUGHT, not by review.
 *
 * With the root pinned, all three runs do identical work, so they
 * refuse together or not at all. A PARTIAL refusal is therefore not an
 * environment fact; it is the defect, and it must fail here.
 */
test("audit-gate reports the same advisories from every cwd", (t) => {
  const runs = CWDS.map((cwd) => ({ cwd, ...gate("audit-gate.mjs", cwd) }));
  if (runs.every((r) => r.status === 2)) {
    t.skip("`npm audit` could not run here (exit 2 from every cwd is refusal, not failure)");
    return;
  }
  for (const r of runs) {
    assert.equal(r.status, 0, `audit-gate failed in ${r.cwd}:\n${r.stdout}${r.stderr}`);
  }
  const outputs = new Set(runs.map((r) => r.stdout.trim()));
  assert.equal(
    outputs.size,
    1,
    `audit-gate's reading depends on cwd:\n${
      runs.map((r) => `  ${r.cwd}\n    ${r.stdout.trim()}`).join("\n")
    }`,
  );
});

test("audit-gate refuses a root with no npm project rather than reporting PASS", () => {
  // The generalising half of the fix. Pinning the root fixes this
  // instance; refusing when the root holds no manifest is what stops the
  // gate printing PASS over an empty scan for any other reason.
  // `audit-gate.mjs` imports only node: builtins, so a bare copy runs.
  const dir = mkdtempSync(join(tmpdir(), "barwise-audit-"));
  try {
    mkdirSync(join(dir, "scripts"));
    writeFileSync(
      join(dir, "scripts", "audit-gate.mjs"),
      readFileSync(join(SCRIPTS, "audit-gate.mjs")),
    );
    const r = spawnSync(process.execPath, [join(dir, "scripts", "audit-gate.mjs")], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(r.status, 2, `expected refusal, got ${r.status}:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /no npm project/);
    assert.doesNotMatch(r.stdout, /PASS/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- barwise-906: every gate proven red before it is trusted green ---

test("check-no-nul fails on a TRACKED NUL byte and passes without one", () => {
  const dir = tempRepo();
  try {
    stage(dir, "clean.md", "no nul here\n");
    assert.equal(gate("check-no-nul.mjs", dir).status, 0, "a clean tree must pass");

    stage(dir, "bad.md", `probe${NUL}nul\n`);
    const red = gate("check-no-nul.mjs", dir);
    assert.equal(red.status, 1, "a tracked NUL byte must fail the gate");
    assert.match(`${red.stdout}${red.stderr}`, /bad\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-no-nul does NOT see an untracked NUL file", () => {
  // Pinning the trap, not the feature. A probe written to disk but never
  // `git add`ed is invisible to a gate that enumerates through
  // `git ls-files` -- which is how this gate was once "verified" against
  // a file it could not reach, and reported OK. Asserting the blind spot
  // stops the next person re-running that experiment and believing it.
  const dir = tempRepo();
  try {
    stage(dir, "clean.md", "no nul here\n");
    writeFileSync(join(dir, "untracked.md"), `probe${NUL}nul\n`);
    assert.equal(
      gate("check-no-nul.mjs", dir).status,
      0,
      "untracked files are out of scope; a probe must be staged to test this gate",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-shell fails on a tracked script with a shellcheck finding", () => {
  const dir = tempRepo();
  try {
    stage(dir, "ok.sh", "#!/usr/bin/env bash\nset -euo pipefail\necho hi\n");
    assert.equal(gate("check-shell.mjs", dir).status, 0, "a clean script must pass");

    // SC2164, a `cd` whose failure leaves every later command running
    // somewhere unintended. Chosen because it is a DEFAULT check, so this
    // test does not depend on .shellcheckrc reaching a temp directory.
    stage(dir, "bad.sh", "#!/usr/bin/env bash\ncd /tmp\n");
    const red = gate("check-shell.mjs", dir);
    assert.equal(red.status, 1, "a shellcheck finding must fail the gate");
    assert.match(`${red.stdout}${red.stderr}`, /bad\.sh/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- check-secrets: the one defect a follow-up commit cannot fix ---

/**
 * Credential-shaped probes, assembled at RUNTIME.
 *
 * Every value is concatenation rather than a literal, for the same reason
 * `NUL` at the top of this file is an escape: `check-secrets` scans this
 * repository's whole history, including this file, so a literal here would
 * make the gate fail on its own test forever after. Each string is split at
 * the exact position its rule anchors on, which is why the splits look
 * arbitrary and are not.
 *
 * These are shapes, not keys. Nothing here has ever been valid anywhere.
 *
 * Three rules, chosen because they cover the three cases that matter:
 * gitleaks' own vendor rule, gitleaks' structural rule, and the ONE rule
 * this repository adds in `.gitleaks.toml` because the default set has
 * none.
 *
 * The bodies are high-entropy on purpose. gitleaks applies an entropy
 * model, and a first attempt at these probes used sequential alphabets
 * ("0123456789abcdef...") which fell below its threshold and were not
 * detected -- so the test would have proved the wrapper silent rather than
 * the scanner working.
 */
/**
 * `probe` is the credential itself; `content` is the file it sits in.
 *
 * The field is named `probe` and every value is split, because naming it
 * `secret` made this table match gitleaks' own `generic-api-key` rule --
 * `secret: "<high-entropy string>"` is precisely that rule's shape -- and
 * the gate failed on its own test file at this line. Caught by the gate,
 * once the file was staged and it could see it.
 *
 * They are separate fields because the redaction assertion below needs the
 * CREDENTIAL ITSELF, and asserting on the whole surrounding line instead let a real
 * regression through. With `--redact` removed, gitleaks prints
 * `Finding: aws_key = "<ESC>[1;3;mAKIA...` -- the key in the clear, but with
 * an ANSI sequence between the quote and the key and no closing quote. A
 * check for the surrounding line therefore did not match, `npm run mutate`
 * reported UNCAUGHT, and the one property this gate exists to hold was
 * unasserted while reading as covered.
 */
const GITLEAKS_PROBES = {
  "aws-access-token": {
    probe: "AKIA" + "3QT7XKVBZ2WRMNPL",
    content: (s) => `aws_key = "${s}"\n`,
  },
  "anthropic-api-key": {
    probe: "sk-ant-" + "api03-"
      + "7Kq2Vx9mTwRbN4yLp" + "Z3jHcF8sAdE6gUn1oIx" + "BvCzMlQeRtYuWiHgFdSaPoKjNm-QwErTy",
    content: (s) => `ANTHROPIC_API_KEY=${s}\n`,
  },
  // BOTH armour lines are split, not just the opening one: gitleaks'
  // private-key rule needs the closing marker too (a probe without it was
  // measured undetected), and the rule matches from BEGIN across to the
  // closing KEY-----, so leaving either intact in this source file would
  // make the gate flag its own test.
  "private-key": {
    probe: "MIIBOgIBAAJBAK7" + "xYzQdJhFyUcEaSbNi" + "OkRtLwVmXpYq4H3G8" + "DZgT7xKvBz2WrMnPl",
    content: (s) =>
      "-----BEGIN RSA PRIVATE" + ` KEY-----\n${s}\n` + "-----END RSA PRIVATE" + " KEY-----\n",
  },
};

/**
 * A throwaway repo carrying THIS repository's real `.gitleaks.toml`.
 *
 * The real config rather than a fixture, deliberately: the Anthropic rule
 * is the one piece of detection barwise owns, so a test against a
 * hand-written config would be testing the fixture. The wrapper refuses
 * when the config is missing, so the copy is also what makes these repos
 * scannable at all.
 */
function secretsRepo() {
  const dir = tempRepo();
  // Staged and committed, not merely written: the shallow-clone test below
  // clones this repo, and `git clone` does not carry untracked files -- so an
  // unstaged config made the clone refuse for a missing config rather than
  // for being shallow, which is a different question and passed for the
  // wrong reason.
  stage(dir, ".gitleaks.toml", readFileSync(join(REPO, ".gitleaks.toml"), "utf8"));
  stage(dir, "clean.txt", "nothing credential-shaped here\n");
  execFileSync("git", ["commit", "-qm", "base"], { cwd: dir });
  return dir;
}

function commitAll(dir, message) {
  execFileSync("git", ["commit", "-qm", message], { cwd: dir });
}

/**
 * Each rule shown RED on a staged probe of its own shape, and GREEN
 * without one.
 *
 * The negative half is what makes the gate's clean reading on the real
 * repository worth anything: a scanner that cannot fire is
 * byte-indistinguishable from a repository with no secrets in it --
 * barwise-902's shape, a check that banks a guaranteed point instead of
 * measuring.
 */
for (const [rule, { probe, content }] of Object.entries(GITLEAKS_PROBES)) {
  test(`check-secrets fails on a staged ${rule}`, () => {
    const dir = secretsRepo();
    try {
      assert.equal(
        gate("check-secrets.mjs", dir, "--staged").status,
        0,
        "a clean index must pass",
      );

      stage(dir, "probe.txt", content(probe));
      const red = gate("check-secrets.mjs", dir, "--staged");
      assert.equal(red.status, 1, `a staged ${rule} must fail the gate`);
      const out = `${red.stdout}${red.stderr}`;
      assert.match(out, new RegExp(rule));
      assert.match(out, /ROTATE IT FIRST/);

      // The redaction rule, asserted per rule rather than argued once. CI
      // logs are retained and searchable, so a gate that echoes its
      // finding becomes a second durable copy of the leak.
      assert.ok(
        !out.includes(probe),
        `check-secrets printed the credential for ${rule}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("check-secrets refuses when gitleaks is absent rather than reporting clean", () => {
  // The container this project develops in does not ship gitleaks, so this
  // is the reading a fresh session gets until the bootstrap installs it.
  const dir = secretsRepo();
  const stubDir = mkdtempSync(join(tmpdir(), "barwise-nogl-"));
  try {
    writeFileSync(join(stubDir, "gitleaks"), "#!/bin/sh\nexit 127\n");
    chmodSync(join(stubDir, "gitleaks"), 0o755);
    const r = spawnSync(process.execPath, [join(SCRIPTS, "check-secrets.mjs"), "--staged"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}` },
    });
    assert.equal(r.status, 2, `expected refusal, got ${r.status}:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /not installed/);
    assert.doesNotMatch(r.stdout, /OK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test("check-secrets refuses a gitleaks status that is neither clean nor a finding", () => {
  // The distinction the wrapper exists for. gitleaks uses 1 for findings,
  // so any OTHER non-zero status is the tool failing to run -- and
  // reporting that as a finding would send the reader hunting a credential
  // that was never there, while reporting it as clean is the false green
  // the refusal contract forbids.
  const dir = secretsRepo();
  const stubDir = mkdtempSync(join(tmpdir(), "barwise-glbad-"));
  try {
    writeFileSync(
      join(stubDir, "gitleaks"),
      "#!/bin/sh\ncase \"$1\" in version) echo 8.28.0;; *) echo 'boom' >&2; exit 3;; esac\n",
    );
    chmodSync(join(stubDir, "gitleaks"), 0o755);
    const r = spawnSync(process.execPath, [join(SCRIPTS, "check-secrets.mjs"), "--staged"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}` },
    });
    assert.equal(r.status, 2, `expected refusal, got ${r.status}:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /neither clean nor a finding/);
    assert.doesNotMatch(r.stdout, /OK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test("check-secrets refuses when .gitleaks.toml is missing", () => {
  // Without this, gitleaks falls back to its bundled defaults: it would
  // still find most things and would silently drop the Anthropic rule,
  // which is the credential this repository is most likely to leak and the
  // one the default set does not have. A gate running a weaker rule set
  // than it claims is this spec's own subject.
  const dir = secretsRepo();
  try {
    rmSync(join(dir, ".gitleaks.toml"));
    const r = gate("check-secrets.mjs", dir, "--staged");
    assert.equal(r.status, 2, `expected refusal, got ${r.status}:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /no \.gitleaks\.toml/);
    assert.doesNotMatch(r.stdout, /OK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-secrets refuses a history scan of a shallow clone, but --staged still works", () => {
  // Every fresh session clone of this project is shallow. A history scan
  // there would report a clean bill of health over whatever few commits
  // arrived, which is why the default mode refuses -- while `--staged`
  // reads the index, which a shallow clone has in full, so the pre-commit
  // path keeps working regardless (docs/specs/gate-refusal-contract.spec.md).
  const src = secretsRepo();
  const parent = mkdtempSync(join(tmpdir(), "barwise-shallow-"));
  try {
    stage(src, "b.txt", "two\n");
    commitAll(src, "two");

    const clone = join(parent, "clone");
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${src}`, clone]);
    assert.equal(
      execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
        cwd: clone,
        encoding: "utf8",
      }).trim(),
      "true",
      "the fixture must actually be shallow, or this test asserts nothing",
    );

    const deep = gate("check-secrets.mjs", clone);
    assert.equal(deep.status, 2, `expected refusal, got ${deep.status}:\n${deep.stderr}`);
    assert.match(deep.stderr, /SHALLOW/);
    assert.doesNotMatch(deep.stdout, /OK/);

    assert.equal(
      gate("check-secrets.mjs", clone, "--staged").status,
      0,
      "--staged does not depend on clone depth",
    );
  } finally {
    rmSync(src, { recursive: true, force: true });
    rmSync(parent, { recursive: true, force: true });
  }
});

test("check-secrets gives the same reading from every cwd", () => {
  // barwise-905's property. `--staged` rather than the history mode so the
  // test does not depend on whether this clone happens to be shallow.
  const runs = CWDS.map((cwd) => ({ cwd, ...gate("check-secrets.mjs", cwd, "--staged") }));
  for (const r of runs) {
    assert.equal(r.status, 0, `check-secrets failed in ${r.cwd}:\n${r.stdout}${r.stderr}`);
  }
  assert.equal(
    new Set(runs.map((r) => r.stdout.trim())).size,
    1,
    `check-secrets' reading depends on cwd:\n${
      runs.map((r) => `  ${r.cwd}\n    ${r.stdout.trim()}`).join("\n")
    }`,
  );
});

// --- check-beads: a note that says "shipped" on an issue that is not closed ---

/** One canonical JSONL line: every required field, `_type` first, compact. */
function issueLine(overrides) {
  const stamp = "2026-01-01T00:00:00Z";
  return JSON.stringify({
    _type: "issue",
    id: "t-1",
    title: "t",
    status: "open",
    priority: 2,
    issue_type: "task",
    owner: "x",
    created_at: stamp,
    created_by: "x",
    updated_at: stamp,
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
    ...overrides,
  }) + "\n";
}

function beadsCheck(jsonl) {
  const dir = mkdtempSync(join(tmpdir(), "barwise-beads-"));
  try {
    const file = join(dir, "issues.jsonl");
    writeFileSync(file, jsonl);
    // bash, not node: the gate is a shell wrapper over `uv run`. Run from
    // the repo so `git rev-parse` finds the pyproject the wrapper points
    // uv at; the file under test is the explicit argument.
    return spawnSync("bash", [join(SCRIPTS, "check-beads.sh"), "--strict", file], {
      cwd: REPO,
      encoding: "utf8",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("check-beads --strict fails an open issue whose notes claim a shipped PR", () => {
  const red = beadsCheck(issueLine({ notes: "Shipped in PR #236. Done." }));
  assert.equal(
    red.status,
    1,
    `expected the shipped-but-open line to fail:\n${red.stdout}${red.stderr}`,
  );
  assert.match(red.stdout, /notes say 'Shipped in PR #236'/);

  const closed = beadsCheck(issueLine({ status: "closed", notes: "Shipped in PR #236." }));
  assert.equal(
    closed.status,
    0,
    `a closed issue may say shipped:\n${closed.stdout}${closed.stderr}`,
  );

  // The wording that is legitimately in_progress must not trip it.
  const pending = beadsCheck(
    issueLine({ status: "in_progress", notes: "Implemented (PR pending)." }),
  );
  assert.equal(pending.status, 0, `PR pending is not shipped:\n${pending.stdout}${pending.stderr}`);
});

/**
 * `beads-crud update` in a throwaway repo carrying one issue, so a
 * destructive write can be attempted without risking this repo's tracker.
 */
function beadsCrud(notes, ...args) {
  const dir = tempRepo();
  try {
    mkdirSync(join(dir, ".beads"), { recursive: true });
    writeFileSync(join(dir, ".beads", "issues.jsonl"), issueLine({ notes }));
    const run = spawnSync(
      process.execPath,
      [join(SCRIPTS, "beads-crud.mjs"), ...args],
      { cwd: dir, encoding: "utf8" },
    );
    const after = JSON.parse(readFileSync(join(dir, ".beads", "issues.jsonl"), "utf8").trim());
    return { ...run, notesAfter: after.notes };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("beads-crud update refuses to blank a non-empty field, and clears it on request", () => {
  // The incident: `--notes "$(node beads-crud.mjs show X --json)"`. The
  // inner command was refused for the unknown flag, exited 1, and the
  // substitution yielded "". The write then reported success and 4544
  // characters of barwise-906's notes were gone -- recovered only because
  // the file is tracked. Every field this tool writes is reachable the
  // same way, so the refusal is on the write, not on one flag.
  const red = beadsCrud("four thousand characters of history", "update", "t-1", "--notes", "");
  assert.equal(red.status, 1, `expected a refusal:\n${red.stdout}${red.stderr}`);
  assert.match(red.stderr + red.stdout, /would erase 35 characters/);
  assert.equal(
    red.notesAfter,
    "four thousand characters of history",
    "a refused update must not have written anything",
  );

  const deliberate = beadsCrud(
    "history",
    "update",
    "t-1",
    "--notes",
    "",
    "--allow-empty",
  );
  assert.equal(
    deliberate.status,
    0,
    `--allow-empty must still clear it:\n${deliberate.stdout}${deliberate.stderr}`,
  );
  assert.equal(deliberate.notesAfter, "");

  // A field that was already empty is not protected by anything, so an
  // empty write to it is not a refusal.
  const wasEmpty = beadsCrud(undefined, "update", "t-1", "--notes", "");
  assert.equal(
    wasEmpty.status,
    0,
    `nothing to erase is not an erasure:\n${wasEmpty.stdout}${wasEmpty.stderr}`,
  );
});

// --- barwise-906: the helper that produces the red-then-green reading ---

/**
 * Run `mutate.mjs` inside a throwaway repo. The helper resolves --file
 * against `git rev-parse --show-toplevel`, so the temp repo IS the repo
 * root as far as it is concerned, and this repo's tree is never touched.
 */
function mutate(dir, args) {
  return spawnSync(process.execPath, [join(SCRIPTS, "mutate.mjs"), ...args], {
    cwd: dir,
    encoding: "utf8",
  });
}

/** A repo holding one subject file and one checker script over it. */
function mutateRepo({ subject, tracked = true }) {
  const dir = tempRepo();
  writeFileSync(join(dir, "subject.txt"), subject);
  if (tracked) {
    execFileSync("git", ["add", "--", "subject.txt"], { cwd: dir });
    execFileSync("git", ["commit", "-qm", "subject"], { cwd: dir });
  }
  // Exits 0 while the subject still says GOOD -- so a mutation that
  // changes GOOD is "caught" and one that does not is "uncaught".
  writeFileSync(
    join(dir, "check.mjs"),
    `import { readFileSync } from "node:fs";\n`
      + `process.exit(readFileSync("subject.txt", "utf8").includes("GOOD") ? 0 : 1);\n`,
  );
  return dir;
}

test("mutate exits 0 when the command catches the mutation, and restores the file", () => {
  const dir = mutateRepo({ subject: "value = GOOD\n" });
  try {
    const r = mutate(dir, [
      "--file",
      "subject.txt",
      "--old",
      "GOOD",
      "--new",
      "BAD",
      "--",
      process.execPath,
      "check.mjs",
    ]);
    assert.equal(r.status, 0, `expected CAUGHT:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /CAUGHT/);
    assert.equal(readFileSync(join(dir, "subject.txt"), "utf8"), "value = GOOD\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutate exits 1 when the command does not notice the mutation", () => {
  const dir = mutateRepo({ subject: "value = GOOD, note = keep\n" });
  try {
    const r = mutate(dir, [
      "--file",
      "subject.txt",
      "--old",
      "keep",
      "--new",
      "drop",
      "--",
      process.execPath,
      "check.mjs",
    ]);
    assert.equal(r.status, 1, `expected UNCAUGHT:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /UNCAUGHT/);
    assert.equal(readFileSync(join(dir, "subject.txt"), "utf8"), "value = GOOD, note = keep\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutate refuses an anchor that is absent or ambiguous, writing nothing", () => {
  // The failure this whole script exists for: a `sed` whose anchor no
  // longer matches leaves the file alone and the suite green, which
  // reads exactly like a test that missed the defect.
  const dir = mutateRepo({ subject: "value = GOOD\nvalue = GOOD\n" });
  try {
    const absent = mutate(dir, [
      "--file",
      "subject.txt",
      "--old",
      "NOT PRESENT",
      "--new",
      "x",
      "--",
      process.execPath,
      "check.mjs",
    ]);
    assert.equal(absent.status, 2, `expected a refusal:\n${absent.stdout}${absent.stderr}`);
    assert.match(absent.stderr, /occurs 0 time\(s\)/);

    const ambiguous = mutate(dir, [
      "--file",
      "subject.txt",
      "--old",
      "GOOD",
      "--new",
      "BAD",
      "--",
      process.execPath,
      "check.mjs",
    ]);
    assert.equal(ambiguous.status, 2, `expected a refusal on 2 matches`);
    assert.match(ambiguous.stderr, /occurs 2 time\(s\)/);

    // Both refusals wrote nothing, which is the part that matters.
    assert.equal(
      readFileSync(join(dir, "subject.txt"), "utf8"),
      "value = GOOD\nvalue = GOOD\n",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutate refuses a no-op replacement", () => {
  const dir = mutateRepo({ subject: "value = GOOD\n" });
  try {
    const r = mutate(dir, [
      "--file",
      "subject.txt",
      "--old",
      "GOOD",
      "--new",
      "GOOD",
      "--",
      process.execPath,
      "check.mjs",
    ]);
    assert.equal(r.status, 2, `expected a refusal:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /no-op mutation proves nothing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutate reports a failed restore on an UNTRACKED file, which git diff cannot", () => {
  // barwise-906's acceptance criteria name this case specifically. The
  // instrument that failed was `git diff --stat` on an untracked file:
  // it prints nothing whether the file is pristine or corrupt, so the
  // check that claimed to prove the restore could not have failed.
  // Here the command under test overwrites the subject, which is what a
  // real command that writes its own inputs would do -- and the helper
  // must notice, on a file git does not track.
  const dir = mutateRepo({ subject: "value = GOOD\n", tracked: false });
  try {
    writeFileSync(
      join(dir, "check.mjs"),
      `import { writeFileSync } from "node:fs";\n`
        + `writeFileSync("subject.txt", "SABOTAGED\\n");\n`
        + `process.exit(1);\n`,
    );
    const r = mutate(dir, [
      "--file",
      "subject.txt",
      "--old",
      "GOOD",
      "--new",
      "BAD",
      "--",
      process.execPath,
      "check.mjs",
    ]);

    // The command "failed", which alone would read as CAUGHT. The
    // restore check outranks it.
    assert.equal(r.status, 2, `expected a restore refusal:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /RESTORE FAILED/);

    // Proof the file really is untracked, so this test cannot silently
    // become the tracked case that git diff WOULD have caught.
    const lsFiles = execFileSync("git", ["ls-files", "--", "subject.txt"], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(lsFiles.trim(), "", "subject.txt must be untracked for this case");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutate refuses a run whose command was KILLED rather than exiting", async () => {
  // The reading this protects is `mutate ... && echo verified`. The
  // status line used to be `run.status === null ? 1`, so a ctrl-c or a
  // harness timeout SIGTERMing the process group sent the run down the
  // CAUGHT branch: exit 0, "the command failed (exit 1)" naming a code
  // the command never returned, and `verified` printed for a run that
  // verified nothing (barwise-998, finding 1).
  //
  // The child hangs so the kill lands mid-run, which is when a real
  // interruption arrives, and it is the CHILD that is killed rather
  // than mutate itself -- what a timeout killing a process group does
  // to the thing actually executing. The exit status is read from the
  // process object rather than through a pipeline, for the reason the
  // helper itself spawns without a shell.
  const dir = mutateRepo({ subject: "value = GOOD\n" });
  const marker = `mutate-kill-probe-${process.pid}.mjs`;
  try {
    writeFileSync(join(dir, marker), `setTimeout(() => {}, 60_000);\n`);

    const child = spawn(process.execPath, [
      join(SCRIPTS, "mutate.mjs"),
      "--file",
      "subject.txt",
      "--old",
      "GOOD",
      "--new",
      "BAD",
      "--",
      process.execPath,
      marker,
    ], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    child.stderr.on("data", (c) => {
      stderr += String(c);
    });

    const exited = new Promise((res) => child.on("exit", (code) => res(code)));

    // Wait until the mutation is on disk, so the kill lands while the
    // command runs rather than during setup. A fixed sleep would make
    // this test time-dependent; the file content is the real signal.
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (readFileSync(join(dir, "subject.txt"), "utf8").includes("BAD")) break;
      await new Promise((res) => setTimeout(res, 25));
    }
    assert.match(
      readFileSync(join(dir, "subject.txt"), "utf8"),
      /BAD/,
      "the mutation never reached disk, so this test would kill the wrong phase",
    );

    // A marker unique to this run, so the kill cannot reach another
    // test's child or a developer's unrelated process.
    spawnSync("pkill", ["-TERM", "-f", marker], { stdio: "ignore" });

    const status = await exited;

    assert.equal(
      status,
      2,
      `a killed run must refuse, not report CAUGHT. stderr:\n${stderr}`,
    );
    assert.match(stderr, /killed by SIG/);

    // The tree is still restored, which is the other half of the
    // guarantee and the reason the `finally` exists.
    assert.equal(readFileSync(join(dir, "subject.txt"), "utf8"), "value = GOOD\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutate refuses, rather than reporting UNCAUGHT, when the restore THROWS", () => {
  // An exception inside restoreOrDie used to propagate, and Node exits
  // 1 on an uncaught throw -- which is this script's UNCAUGHT code. So
  // a command that replaced the target with a directory printed a stack
  // trace and then reported, in the one number a caller reads, that the
  // suite had failed to notice the mutation (barwise-998).
  const dir = mutateRepo({ subject: "value = GOOD\n" });
  try {
    writeFileSync(
      join(dir, "check.mjs"),
      `import { mkdirSync, rmSync } from "node:fs";\n`
        + `rmSync("subject.txt");\n`
        + `mkdirSync("subject.txt");\n`
        + `process.exit(1);\n`,
    );
    const r = mutate(dir, [
      "--file",
      "subject.txt",
      "--old",
      "GOOD",
      "--new",
      "BAD",
      "--",
      process.execPath,
      "check.mjs",
    ]);

    assert.equal(r.status, 2, `expected a refusal:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /RESTORE FAILED/);
    assert.match(r.stderr, /EISDIR|illegal operation on a directory/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every scripts/*.mjs path a skill cites exists", () => {
  // mutation-verification-helper.spec.md claimed `check:book-citations`
  // guarded these, so a rename that missed one would fail a gate. That
  // checker resolves Halpin & Morgan SECTION NUMBERS and knows nothing
  // about file paths, so the citations in session-review/SKILL.md and
  // pr-review/checklist.md were an unguarded must-agree copy
  // (barwise-998, finding 3). This is the guard the spec described.
  const docs = execFileSync("git", ["ls-files", "--", ".claude/skills"], {
    cwd: REPO,
    encoding: "utf8",
  }).split("\n").filter((f) => f.endsWith(".md"));

  const missing = [];
  let cited = 0;
  for (const doc of docs) {
    const text = readFileSync(join(REPO, doc), "utf8");
    for (const m of text.matchAll(/\b((?:barwise\/)?scripts\/[\w./-]*\.mjs)\b/g)) {
      cited++;
      const rel = m[1].startsWith("barwise/") ? m[1] : join("barwise", m[1]);
      if (!existsSync(join(REPO, rel))) missing.push(`${doc}: ${m[1]}`);
    }
  }

  // The denominator beside the count, so an empty result cannot read as
  // "nothing is broken" when the scan has stopped matching anything.
  assert.ok(cited > 0, "no scripts/*.mjs citations found under .claude/skills -- scan broken");
  assert.deepEqual(
    missing,
    [],
    `skill docs cite scripts that do not exist:\n${missing.join("\n")}`,
  );
});

test("check-root-scripts fails on drift in either direction", () => {
  const dir = tempRepo();
  const inner = (scripts) => `${JSON.stringify({ name: "inner", scripts }, null, 2)}\n`;
  const root = (scripts) => `${JSON.stringify({ name: "r", private: true, scripts }, null, 2)}\n`;
  const fwd = (name) => `npm --prefix barwise run ${name} --`;
  try {
    stage(dir, "barwise/package.json", inner({ build: "tsc", lint: "oxlint" }));
    stage(dir, "package.json", root({ build: fwd("build"), lint: fwd("lint") }));
    assert.equal(
      gate("regen-root-package.mjs", dir, "--check").status,
      0,
      "matching forwarders must pass",
    );

    // A script added to barwise/ with no forwarder at the root.
    stage(dir, "barwise/package.json", inner({ build: "tsc", lint: "oxlint", added: "x" }));
    let red = gate("regen-root-package.mjs", dir, "--check");
    assert.equal(red.status, 1, "a missing forwarder must fail");
    assert.match(`${red.stdout}${red.stderr}`, /added/);

    // A forwarder for a script that no longer exists.
    stage(dir, "barwise/package.json", inner({ build: "tsc" }));
    stage(dir, "package.json", root({ build: fwd("build"), gone: fwd("gone") }));
    red = gate("regen-root-package.mjs", dir, "--check");
    assert.equal(red.status, 1, "a stale forwarder must fail");
    assert.match(`${red.stdout}${red.stderr}`, /gone/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- barwise-910: the spec-status gate, pinned against real history ---

/**
 * This gate's whole claim is "it would have caught the header that went
 * stale", and that claim is checkable rather than assertable: `--at
 * <commit>` runs it against a historical tree. 7fbbba7 shipped
 * workstream 1 of barwise-902 while
 * `must-validate-outside-the-rubric.spec.md` still read "design only --
 * no implementation in this PR".
 *
 * Mutating a Status on today's tree would NOT reproduce that condition:
 * the gate compares against the commit that last touched the spec, and
 * both specs involved have been edited since. A red test written that
 * way passes, which is the barwise-906 shape -- so the red reading has
 * to come from the commit where the defect actually was.
 */
test("audit-spec-status fires on the header that went stale at 7fbbba7", () => {
  const r = gate("audit-spec-status.mjs", REPO, "--at", "7fbbba7");
  assert.equal(r.status, 0, `--at failed:\n${r.stdout}${r.stderr}`);
  assert.match(
    r.stdout,
    /must-validate-outside-the-rubric\.spec\.md/,
    `the gate did not fire on the defect it exists for:\n${r.stdout}`,
  );
  assert.match(r.stdout, /since: 7fbbba7/, `wrong reason:\n${r.stdout}`);
});

test("audit-spec-status --check is green on the current tree, from every cwd", (t) => {
  // A shallow clone cannot answer this gate's question, and the gate now
  // says so instead of printing OK -- which is how it shipped red once:
  // 309 commits locally against CI's full history. Skipping loudly here
  // is not the silent hole; reporting the smaller question's answer was.
  const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
    cwd: REPO,
    encoding: "utf8",
  }).trim() === "true";
  if (shallow) {
    t.skip("shallow clone: run `git fetch --unshallow` to exercise this gate");
    return;
  }
  for (const cwd of CWDS) {
    const r = gate("audit-spec-status.mjs", cwd, "--check");
    assert.equal(r.status, 0, `--check failed in ${cwd}:\n${r.stdout}${r.stderr}`);
  }
});

/**
 * The claim regex matched "no implementation" and a leading draft or
 * proposed, and nothing else. Two specs written on 2026-09-06 said
 * "no workstream implemented" and sat outside the gate for a whole
 * workstream's worth of commits; the first PR to land one of them
 * found the hole and said so in its session review (#426). The
 * planted defect is the exact phrasing, on a spec that names a code
 * file a later commit touches: red until the regex knows the phrase.
 */
test("audit-spec-status fires on 'no workstream implemented', the phrasing that escaped", () => {
  const dir = tempRepo();
  try {
    stage(dir, "barwise/packages/core/src/a.ts", "export const a = 1;\n");
    stage(
      dir,
      "barwise/docs/specs/x.spec.md",
      "# x\n\nStatus: Design review complete -- no workstream implemented\n\nTouches `packages/core/src/a.ts`.\n",
    );
    execFileSync("git", ["commit", "-qm", "spec"], { cwd: dir });
    stage(dir, "barwise/packages/core/src/a.ts", "export const a = 2;\n");
    execFileSync("git", ["commit", "-qm", "ws1 lands"], { cwd: dir });
    const r = gate("audit-spec-status.mjs", dir, "--at", "HEAD");
    assert.equal(r.status, 0, `--at failed:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /x\.spec\.md/, `the gate did not fire on the phrasing:\n${r.stdout}`);
    // A partial claim is a different question (barwise-912) and must not fire.
    stage(
      dir,
      "barwise/docs/specs/x.spec.md",
      "# x\n\nStatus: WS0 complete; WS1-WS8 not implemented\n\nTouches `packages/core/src/a.ts`.\n",
    );
    execFileSync("git", ["commit", "-qm", "status says what shipped"], { cwd: dir });
    stage(dir, "barwise/packages/core/src/a.ts", "export const a = 3;\n");
    execFileSync("git", ["commit", "-qm", "more"], { cwd: dir });
    const r2 = gate("audit-spec-status.mjs", dir, "--at", "HEAD");
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.match(r2.stdout, /no findings/, `a partial claim fired:\n${r2.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audit-spec-status refuses a shallow clone rather than reporting OK", () => {
  const dir = tempRepo();
  try {
    // A repo with no `--unshallow` marker is not shallow, so this makes
    // one the way git does: the guard reads `rev-parse
    // --is-shallow-repository`, which is true exactly when .git/shallow
    // exists.
    writeFileSync(join(dir, ".git", "shallow"), `${"0".repeat(40)}\n`);
    stage(dir, "barwise/docs/specs/x.spec.md", "# x\n\nStatus: draft\n");
    execFileSync("git", ["commit", "-qm", "spec"], { cwd: dir });
    const r = gate("audit-spec-status.mjs", dir, "--check");
    // 2, not 1. Exit 1 is this gate's "a spec header is wrong"; a short
    // history is "could not answer", and the two sent readers to
    // different places (docs/specs/gate-refusal-contract.spec.md).
    assert.equal(r.status, 2, `expected refusal, got:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /shallow clone/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- barwise-919: a version pinned in two files is a must-agree copy ---
//
// `check-parity` grew a {file,field} member so a value duplicated across
// JSON files is checked the way a duplicated function already was. The
// motivating drift shipped: package.json said engines.node >=26.0.0
// while package-lock.json, which embeds its own copy, said >=20.0.0, and
// all 25 gates passed over the pair.
//
// The comparison loop itself is unchanged and six existing sets exercise
// it. What is new is the path parser and the value resolution, tested
// directly here -- `root` inside the gate is script-relative by design
// (barwise-905 again), so a fixture repo cannot reach `main()`.

const { parseFieldPath, fieldValue } = await import(
  pathToFileURL(join(SCRIPTS, "check-parity.mjs")).href
);

test("parseFieldPath splits dotted keys and bracketed non-identifiers", () => {
  assert.deepEqual(parseFieldPath("version"), ["version"]);
  assert.deepEqual(parseFieldPath("engines.node"), ["engines", "node"]);
  // npm names the lockfile's root package with the empty string, which
  // is the whole reason the bracket form exists.
  assert.deepEqual(
    parseFieldPath('packages[""].engines.node'),
    ["packages", "", "engines", "node"],
  );
  assert.deepEqual(parseFieldPath('a["b.c"].d'), ["a", "b.c", "d"]);
});

test("fieldValue resolves the pair that actually drifted", () => {
  const declared = fieldValue("package.json", "engines.node");
  const embedded = fieldValue("package-lock.json", 'packages[""].engines.node');
  assert.equal(declared, embedded, "engines.node disagrees between package.json and its lockfile");
  assert.match(declared, /^">=\d+\.\d+\.\d+"$/, `unexpected shape: ${declared}`);
});

test("fieldValue treats a path that no longer resolves as an error", () => {
  // A manifest naming a field nobody writes any more is itself drift, so
  // it must fail rather than compare two undefineds and call them equal.
  assert.throws(
    () => fieldValue("package.json", "engines.nodeVersion"),
    /no value at "engines" -> "nodeVersion"/,
  );
  assert.throws(() => fieldValue("package.json", "version.major"), /no value at/);
});

test("every registered field member still resolves", () => {
  const manifest = JSON.parse(
    readFileSync(join(SCRIPTS, "..", "parity.manifest.json"), "utf8"),
  );
  const fields = manifest.sets.flatMap((s) =>
    s.members.filter((m) => typeof m === "object" && m.field !== undefined)
  );
  assert.ok(fields.length > 0, "no field members registered; this test would pass vacuously");
  for (const m of fields) fieldValue(m.file, m.field);
});

// --- barwise-921: every Python execution resolves from the lockfile ---
//
// The gate's ALLOWLIST names `.github/workflows/ci.yml` and is ratcheted,
// so a fixture repo WITHOUT that bootstrap line fails as stale -- which is
// itself one of the cases below. Every other fixture stages the line, so
// the only variable under test is the planted violation.
const UV_BOOTSTRAP = "          python3 -m pip install --quiet uv==0.12.7\n";

function pythonUvRepo(files = {}) {
  const dir = tempRepo();
  stage(dir, ".github/workflows/ci.yml", `jobs:\n  ci:\n    steps:\n${UV_BOOTSTRAP}`);
  for (const [name, contents] of Object.entries(files)) stage(dir, name, contents);
  return dir;
}

/** Run the gate over a fixture repo and drop the repo, as every other
 *  temp-repo test here does. Twelve fixtures per run is twelve leaks. */
function pythonUv(files) {
  const dir = pythonUvRepo(files);
  try {
    return gate("check-python-uv.mjs", dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("check-python-uv passes a repo whose only Python call is the allowlisted bootstrap", () => {
  const r = pythonUv();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no bare interpreters/);
});

// One planted defect per banned form. A gate verified only in aggregate can
// be blind to a whole rule and still look green.
const VIOLATIONS = [
  ["bare python3 in a script", { "s.sh": "#!/bin/sh\npython3 -c 'print(1)'\n" }, /bare `python3`/],
  ["bare pip in a script", { "s.sh": "#!/bin/sh\npip install requests\n" }, /bare `pip`/],
  [
    "bare interpreter behind an env assignment",
    { "s.sh": "#!/bin/sh\nFOO=1 python -c 'print(1)'\n" },
    /bare `python`/,
  ],
  [
    "child_process interpreter in TypeScript",
    { "a.ts": 'execFileSync("python3", ["-c", "import sys"]);\n' },
    /bare `python3` subprocess/,
  ],
  [
    "uv run --with, the lock bypass",
    { "s.sh": "#!/bin/sh\nuv run --frozen --with sqlglot==27.20.0 python -c ''\n" },
    /--with.*lock bypass/,
  ],
  [
    "uv run --isolated",
    { "s.sh": "#!/bin/sh\nuv run --frozen --isolated python -c ''\n" },
    /--isolated/,
  ],
  ["uv pip", { "s.sh": "#!/bin/sh\nuv pip install requests\n" }, /`uv pip`/],
  [
    "uv run with neither --frozen nor --locked",
    { "s.sh": "#!/bin/sh\nuv run python -c ''\n" },
    /neither --frozen nor --locked/,
  ],
  [
    "PEP 723 inline script metadata",
    { "t.py": '# /// script\n# dependencies = ["sqlglot"]\n# ///\n' },
    /PEP 723/,
  ],
  [
    "bare interpreter in a workflow's single-line `- run:` form",
    { "w.yml": "jobs:\n  a:\n    steps:\n      - run: python3 -m tool\n" },
    /bare `python3`/,
  ],
  [
    "a Python file spawning a bare interpreter",
    { "t.py": 'import subprocess\n\nsubprocess.run(["python3", "-c", "print(1)"])\n' },
    /bare `python3` subprocess/,
  ],
  [
    "uv run --no-project",
    { "s.sh": "#!/bin/sh\nuv run --frozen --no-project python -c ''\n" },
    /--no-project/,
  ],
  ["uvx, which resolves from the index", { "s.sh": "#!/bin/sh\nuvx sqlglot --version\n" }, /uvx/],
  ["uv tool run", { "s.sh": "#!/bin/sh\nuv tool run sqlglot\n" }, /uv tool run/],
];

for (const [name, files, expected] of VIOLATIONS) {
  test(`check-python-uv fails on ${name}`, () => {
    const r = pythonUv(files);
    assert.equal(r.status, 1, `expected failure, got:\n${r.stdout}`);
    assert.match(r.stderr, expected);
  });
}

test("check-python-uv fails on a STALE allowlist entry, so a fixed site forces its row out", () => {
  // No ci.yml at all: the bootstrap the allowlist exempts no longer exists.
  const dir = tempRepo();
  stage(dir, "README.md", "nothing to see\n");
  const r = gate("check-python-uv.mjs", dir);
  assert.equal(r.status, 1, `expected failure, got:\n${r.stdout}`);
  assert.match(r.stderr, /STALE allowlist entry/);
});

test("check-python-uv does not flag a mention inside a quoted string", () => {
  // `echo "== uv sync"` is a heading, not an invocation. Flagging it is how
  // a gate cries wolf on the repo's own error messages and gets disabled.
  const r = pythonUv({ "s.sh": '#!/bin/sh\necho "== uv sync"\nuv sync --frozen\n' });
  assert.equal(r.status, 0, r.stderr);
});

test("check-python-uv does not flag `python` as a language label", () => {
  // packages/code-analysis maps ".py" -> "python". A quoted name alone is
  // not an invocation; the child_process call around it is what matters.
  const r = pythonUv({ "a.ts": 'const LANG = { ".py": "python" } as const;\n' });
  assert.equal(r.status, 0, r.stderr);
});

// The six call sites this rule was written for spell uv as
// `execFileSync("uv", [...UV_PYTHON, "-c", src])`, with the flags in a
// spread const several lines up. A line matcher cannot see that at all --
// deleting "--frozen" from both SqlglotBridge copies passed check:parity
// AND this gate before these cases existed.
const ARGS_ARRAY = [
  [
    "uv args array carrying neither --frozen nor --locked",
    'const UV = ["run", "--only-group", "sqlglot", "python"] as const;\n'
    + 'execFileSync("uv", [...UV, "-c", src]);\n',
    /neither --frozen nor --locked/,
  ],
  [
    "uv args array carrying --with, the lock bypass",
    'const UV = ["run", "--frozen", "--with", "sqlglot==1.0", "python"] as const;\n'
    + 'execFileSync("uv", [...UV, "-c", src]);\n',
    /--with.*lock bypass/,
  ],
  [
    "uv pip through an args array",
    'execFileSync("uv", ["pip", "install", "sqlglot"]);\n',
    /`uv pip`/,
  ],
];

for (const [name, source, expected] of ARGS_ARRAY) {
  test(`check-python-uv fails on ${name}`, () => {
    const r = pythonUv({ "a.ts": source });
    assert.equal(r.status, 1, `expected failure, got:\n${r.stdout}`);
    assert.match(r.stderr, expected);
  });
}

test("check-python-uv passes a compliant uv args array", () => {
  const r = pythonUv({
    "a.ts": 'const UV = ["run", "--frozen", "--only-group", "sqlglot", "python"] as const;\n'
      + 'execFileSync("uv", [...UV, "-c", src]);\n',
  });
  assert.equal(r.status, 0, r.stderr);
});

// --- check-book-citations: every citation resolves against the transcript ---

const CONTENTS = `# contents

\`\`\`
 3  Conceptual Modeling: First Steps                                 59
    3.3  CSDP Step 1: From Examples to Elementary Facts              63
    3.5  CSDP Step 3: Trim Schema; Note Basic Derivations            97
 4  Uniqueness Constraints                                          111
    4.4  External Uniqueness Constraints                            129
 5  Mandatory Roles                                                 159
    5.3  Reference Schemes                                          173
ORM Glossary                                                       1007
\`\`\`
`;

/** A repo with the transcript and one citing card; the gate reads both. */
function bookCitations(card) {
  const dir = tempRepo();
  stage(dir, "barwise/docs/halpin-morgan-3e-contents.md", CONTENTS);
  stage(dir, "barwise/docs/anki/x.txt", `front\tback ${card}\n`);
  try {
    return gate("check-book-citations.mjs", dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("check-book-citations passes a citation that resolves, and reports its coverage", () => {
  const r = bookCitations(
    "Read more: Halpin & Morgan 3rd ed. -- ch. 5, section 5.3 (reference schemes).",
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /book citations OK: \d+ citations in 2 files/);
});

// One planted defect per rule. The first is the exact drift the gate was
// written for: a section that exists, glossed with another section's topic.
const BAD_CITATIONS = [
  [
    "a right number with the wrong topic",
    "Halpin & Morgan 3rd ed. -- section 3.5 (reference schemes).",
    /section 3\.5 is "CSDP Step 3: Trim Schema; Note Basic Derivations", but the gloss says \(reference schemes\)/,
  ],
  [
    "a section the book does not have",
    "Halpin & Morgan 3rd ed. -- section 9.9.",
    /section 9\.9 is not in the 3rd ed\. contents/,
  ],
  [
    "a chapter the book does not have",
    "Halpin & Morgan 3rd ed. -- ch. 99 (nothing).",
    /chapter 99 is not in the 3rd ed\. contents/,
  ],
  [
    "a page span that is not the chapter's",
    "Halpin & Morgan 3rd ed. -- ch. 3, pp. 59-111.",
    /chapter 3 spans pp\. 59-110 in the contents, not pp\. 59-111/,
  ],
  [
    "another edition",
    "Halpin & Morgan, Information Modeling (2nd ed.), ch. 3.",
    /cites the 2nd edition/,
  ],
];

for (const [name, card, expected] of BAD_CITATIONS) {
  test(`check-book-citations fails on ${name}`, () => {
    const r = bookCitations(card);
    assert.equal(r.status, 1, `expected red:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, expected);
  });
}

test("check-book-citations leaves a barwise reference after the `;` alone", () => {
  // 3.4 is not in the fixture transcript; after "barwise ARCHITECTURE.md" it is not a book citation.
  const r = bookCitations(
    "Halpin & Morgan 3rd ed. -- ch. 4 (uniqueness); barwise ARCHITECTURE.md sections 3.4-3.5.",
  );
  assert.equal(r.status, 0, r.stderr);
});

test("check-book-citations fails on a book-scoped file that exists but is untracked", () => {
  // The blind spot barwise-906 names, met again while writing the guide:
  // four green runs never read it, because the scan enumerates tracked
  // files and the guide had not been added. Written to disk only, on purpose.
  const dir = tempRepo();
  stage(dir, "barwise/docs/halpin-morgan-3e-contents.md", CONTENTS);
  const guide = join(dir, "barwise/docs/halpin-morgan-3e-reading-guide.md");
  mkdirSync(dirname(guide), { recursive: true });
  writeFileSync(guide, "section 9.9 (nowhere)\n");
  try {
    const r = gate("check-book-citations.mjs", dir);
    assert.equal(r.status, 1, `expected red:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /reading-guide\.md:0  exists but is not tracked/);
    assert.doesNotMatch(r.stderr, /9\.9/, "an untracked file must not be read either");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-book-citations is green on the current tree, from every cwd", () => {
  const runs = CWDS.map((cwd) => ({ cwd, ...gate("check-book-citations.mjs", cwd) }));
  for (const r of runs) assert.equal(r.status, 0, `failed in ${r.cwd}:\n${r.stdout}${r.stderr}`);
  assert.equal(new Set(runs.map((r) => r.stdout.trim())).size, 1, "coverage depends on cwd");
});

// --- barwise-960: a local CI run reports its own tree, and says what broke ---

/**
 * A throwaway checkout shaped like this one, so `ci-local.mjs` finds the
 * things it resolves relative to itself: `../.github/workflows/ci.yml`
 * for the gate list, and `package.json` beside it for the scripts.
 *
 * A throwaway rather than this repo, for one specific reason: `npm run
 * test:scripts` is itself a gate inside `ci:local`, so a test that wrote
 * to the real lock file would corrupt the lock of the run executing it.
 */
function tempCiRepo() {
  const dir = mkdtempSync(join(tmpdir(), "barwise-cilocal-"));
  const root = join(dir, "barwise");
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(
    join(dir, ".github", "workflows", "ci.yml"),
    [
      "jobs:",
      "  build:",
      "    steps:",
      "      - run: npm ci",
      "      - run: npm run pass",
      "      - run: npm run boom",
      "",
    ]
      .join("\n"),
  );
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "fake",
      private: true,
      scripts: { pass: 'node -e ""', boom: "node scripts/boom.mjs" },
    }),
  );
  // The marker is the FIRST line and the filler is longer than the tail
  // the summary prints, so a marker found in the log file could only have
  // come from the log file.
  writeFileSync(
    join(root, "scripts", "boom.mjs"),
    [
      'console.log("MARKER-FIRST-LINE");',
      "for (let i = 1; i <= 200; i++) console.log(`filler ${i}`);",
      "console.log(`COVERAGE_DIR=${process.env.BARWISE_COVERAGE_DIR}`);",
      "process.exit(1);",
      "",
    ].join("\n"),
  );
  writeFileSync(join(root, "scripts", "ci-local.mjs"), readFileSync(join(SCRIPTS, "ci-local.mjs")));
  // The gate list itself lives in `lib/ci-gates.mjs`, shared with
  // `fault-matrix.mjs` so two parsers cannot drift over one workflow
  // file. A fixture that copies only the entry point gets ERR_MODULE_
  // NOT_FOUND, which the assertions below report as "the summary must
  // name the log directory" -- true, and about nothing.
  mkdirSync(join(root, "scripts", "lib"), { recursive: true });
  writeFileSync(
    join(root, "scripts", "lib", "ci-gates.mjs"),
    readFileSync(join(SCRIPTS, "lib", "ci-gates.mjs")),
  );
  return {
    dir,
    root,
    script: join(root, "scripts", "ci-local.mjs"),
    lock: join(root, "node_modules", ".ci-local.lock"),
  };
}

function runCiLocal(repo, ...args) {
  const r = spawnSync(process.execPath, [repo.script, ...args], {
    cwd: repo.dir,
    encoding: "utf8",
  });
  return { ...r, all: `${r.stdout}${r.stderr}` };
}

/**
 * The log of ONE named gate, selected by name rather than by being the
 * first `full output:` line in the summary. Written that way after a
 * flake: when a second gate also failed, "the first path printed" was
 * the wrong gate's log, and the test failed for a reason unrelated to
 * what it asserts.
 */
function failureLog(r, gate) {
  const dir = /\nLogs: (\S+)/.exec(r.all);
  assert.ok(dir, `the summary must name the log directory:\n${r.all}`);
  const path = join(dir[1], `${gate}.log`);
  assert.ok(
    r.all.includes(`full output: ${path}`),
    `the summary must name ${gate}'s log file:\n${r.all}`,
  );
  return readFileSync(path, "utf8");
}

test("a failing gate's FULL output is on disk, not just the tail printed", () => {
  // The tail is what this printed before barwise-960: 25 lines, which for
  // a turbo run over twelve packages is the summary footer and the npm
  // error banner and never the failing test's name. Diagnosing one such
  // failure cost three separate reproduction runs.
  const repo = tempCiRepo();
  try {
    const r = runCiLocal(repo);
    assert.equal(r.status, 1, `a failing gate must fail the run:\n${r.all}`);
    assert.doesNotMatch(
      r.all,
      /MARKER-FIRST-LINE/,
      "the printed tail must NOT reach the first line -- if it does, this test proves nothing",
    );

    assert.match(
      failureLog(r, "run-boom"),
      /MARKER-FIRST-LINE/,
      "the log must carry output the tail could not reach",
    );
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("each gate runs with BARWISE_COVERAGE_DIR pointed outside the checkout", () => {
  const repo = tempCiRepo();
  try {
    const r = runCiLocal(repo);
    assert.equal(r.status, 1, `the probing gate must fail so its output is kept:\n${r.all}`);
    const dir = /COVERAGE_DIR=(\S+)/.exec(failureLog(r, "run-boom"));
    assert.ok(dir, "the gate must see BARWISE_COVERAGE_DIR set");
    assert.notEqual(dir[1], "undefined", "the variable must reach the gate's environment");
    assert.ok(
      !dir[1].startsWith(repo.dir),
      `coverage must not be written inside the checkout: ${dir[1]}`,
    );
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("a second run refuses while a live run holds the lock, and runs no gate", () => {
  const repo = tempCiRepo();
  try {
    mkdirSync(dirname(repo.lock), { recursive: true });
    // This test's own pid: alive by construction, for as long as it takes
    // to assert against it.
    writeFileSync(repo.lock, JSON.stringify({ pid: process.pid, started: "2026-09-08T00:00:00Z" }));

    const r = runCiLocal(repo);
    assert.equal(r.status, 1, `a held lock must refuse:\n${r.all}`);
    assert.match(r.all, new RegExp(`already running: pid ${process.pid}`));
    assert.doesNotMatch(r.stdout, /Running \d+ gates/, "it must refuse BEFORE running any gate");
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("a lock whose pid is gone is removed rather than obeyed, and a run releases its own", () => {
  const repo = tempCiRepo();
  try {
    // A pid that has certainly exited: this process waited for it.
    const dead = spawnSync(process.execPath, ["-e", ""]).pid;
    mkdirSync(dirname(repo.lock), { recursive: true });
    writeFileSync(repo.lock, JSON.stringify({ pid: dead, started: "2026-09-08T00:00:00Z" }));

    const r = runCiLocal(repo);
    assert.match(r.stdout, /Running 2 gates/, `a stale lock must not stop a run:\n${r.all}`);
    assert.equal(existsSync(repo.lock), false, "a finished run must release its lock");
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("BARWISE_COVERAGE_DIR survives Turborepo and redirects a real package's coverage", () => {
  // The half the throwaway tests cannot reach. Turborepo 2 runs tasks in
  // strict env mode, so a variable named nowhere in turbo.json is dropped
  // before the task sees it: measured directly, the first version of this
  // change looked isolated and wrote to packages/learn/coverage anyway.
  // Nothing else asserts where coverage lands, so nothing else would
  // notice that line being removed from turbo.json.
  //
  // `learn` because it is the cheapest package with a real coverage run,
  // and `--force` because a cache hit would prove nothing about the
  // environment the task ran in.
  const dir = mkdtempSync(join(tmpdir(), "barwise-covdir-"));
  const barwise = join(REPO, "barwise");
  try {
    const r = spawnSync("npx", [
      "turbo",
      "run",
      "test:coverage",
      "--filter=@barwise/learn",
      "--force",
    ], {
      cwd: barwise,
      encoding: "utf8",
      env: { ...process.env, BARWISE_COVERAGE_DIR: dir },
    });
    assert.equal(r.status, 0, `the coverage task must pass:\n${r.stdout}${r.stderr}`);
    assert.ok(
      existsSync(join(dir, "learn", "coverage-final.json")),
      `coverage must land under BARWISE_COVERAGE_DIR, not in the package:\n${r.stdout}${r.stderr}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- barwise-989 WS3: the fault matrix, and the classifier under it ---
//
// `fault-matrix.mjs` runs every node gate in ci.yml under four
// environment faults and reports which answer, which refuse, and which
// print PASS blind. Its own verdicts need testing for the reason its
// subject does: the interesting verdict (FALSE GREEN) is the one no gate
// in this repository still returns, so a live run cannot exercise it and
// a classifier that never returned it would read exactly as clean.
//
// The end-to-end reading is verified with `npm run mutate` rather than
// here -- planting `process.exit(0)` in `tracked.mjs`'s refusal turns
// five gates into false greens in about a second, and asserting that
// from a test would mean mutating the repository from inside the suite.
// The three mutations and their readings are in
// `docs/specs/gate-refusal-contract.spec.md`.

const fm = await import(pathToFileURL(join(SCRIPTS, "fault-matrix.mjs")).href);
const { ciGates } = await import(pathToFileURL(join(SCRIPTS, "lib", "ci-gates.mjs")).href);

test("classify: a gate that answers 0 having reached for the broken thing is a false green", () => {
  // The verdict the harness exists for. No gate returns it today, which
  // is exactly why it is asserted here rather than trusted to a live run.
  assert.equal(
    fm.classify({ kind: "instrumented", baseline: 0, exit: 0, touched: 1 }).verdict,
    "FALSE GREEN",
  );
  assert.equal(fm.classify({ kind: "instrumented", baseline: 0, exit: 0, touched: 1 }).ok, false);
});

test("classify: refusing is conforming, and never reaching is independence", () => {
  assert.equal(
    fm.classify({ kind: "instrumented", baseline: 0, exit: 2, touched: 1 }).verdict,
    "REFUSED",
  );
  assert.equal(
    fm.classify({ kind: "instrumented", baseline: 0, exit: 0, touched: 0 }).verdict,
    "INDEPENDENT",
  );
  assert.equal(
    fm.classify({ kind: "instrumented", baseline: 0, exit: 1, touched: 1 }).verdict,
    "CRASHED",
  );
  for (const exit of [0, 2, 1]) {
    assert.equal(
      fm.classify({ kind: "instrumented", baseline: 0, exit, touched: 1 }).refused,
      false,
    );
  }
});

test("classify: on the cwd axis a refusal from one directory is a moved reading", () => {
  // The bug this test exists for. The first draft returned REFUSED
  // before looking at the axis, so mutating `audit-gate`'s `cwd: ROOT`
  // pin away -- the original barwise-987 defect -- produced 0, 0, 2
  // across three directories and scored as conforming. `npm run mutate`
  // said UNCAUGHT; nothing else would have.
  const moved = fm.classify({ kind: "invariant", baseline: 0, exit: 2 });
  assert.equal(moved.verdict, "READING MOVED");
  assert.equal(moved.ok, false);
  assert.equal(fm.classify({ kind: "invariant", baseline: 0, exit: 0 }).verdict, "INVARIANT");
});

test("classify: on a different Node major, refusing is the desired behaviour", () => {
  // The opposite of the cwd axis, which is why the kind is explicit. The
  // Node pin exists so an unpinned runtime does not get to answer
  // (v8 coverage is not portable across majors), so exit 2 is the pin
  // working -- while a DIFFERENT answer is the finding.
  assert.equal(fm.classify({ kind: "refusable", baseline: 0, exit: 2 }).verdict, "REFUSED");
  assert.equal(fm.classify({ kind: "refusable", baseline: 0, exit: 0 }).verdict, "INVARIANT");
  assert.equal(fm.classify({ kind: "refusable", baseline: 0, exit: 1 }).verdict, "READING MOVED");
});

test("classify: a gate already failing unperturbed is unreadable, not conforming", () => {
  // Every fault reading would then be about whatever is already wrong.
  // Scoring those rows as conforming is the harness committing the
  // defect it audits, and it is not hypothetical: `check-shell` is in
  // this state in any container without shellcheck.
  for (const kind of ["instrumented", "invariant", "refusable"]) {
    const r = fm.classify({ kind, baseline: 1, exit: 2, touched: 0 });
    assert.equal(r.verdict, "UNREADABLE", `kind ${kind}`);
    assert.equal(r.refused, true, `kind ${kind}`);
    assert.equal(r.ok, false, `kind ${kind}`);
  }
});

test("classify: an axis with no kind is refused rather than scored", () => {
  // A new axis added without a kind would otherwise be judged by
  // whichever branch came first. That is how the cwd bug above got in,
  // so the default case refuses instead of guessing.
  assert.throws(
    () => fm.classify({ kind: "wrong-node", baseline: 0, exit: 0 }),
    /unknown axis kind/,
  );
});

test("fault-matrix resolves a ci.yml step to the node gate it runs", () => {
  const scripts = {
    "check:no-nul": "node scripts/check-no-nul.mjs",
    "audit:specs": "node scripts/audit-spec-status.mjs",
    "fmt:check": "dprint check && node scripts/fmt-root.mjs --check",
    lint: "turbo run lint",
  };
  assert.deepEqual(fm.resolveNodeGate("run check:no-nul", scripts), {
    name: "check:no-nul",
    script: "scripts/check-no-nul.mjs",
    args: [],
  });
  // CI's own spelling of the ratchet mode. Reading package.json's
  // default instead is not a detail: `audit:specs` without `--check`
  // REGENERATES the baseline, and an ad-hoc probe that did exactly that
  // replaced five classified rows with "TODO: classify" and reported a
  // clean run.
  assert.deepEqual(fm.resolveNodeGate("run audit:specs -- --check", scripts), {
    name: "audit:specs",
    script: "scripts/audit-spec-status.mjs",
    args: ["--check"],
  });
  // A compound script: the third-party half is out of scope, the node
  // half is the gate.
  assert.deepEqual(fm.resolveNodeGate("run fmt:check", scripts), {
    name: "fmt:check",
    script: "scripts/fmt-root.mjs",
    args: ["--check"],
  });
  assert.equal(fm.resolveNodeGate("run lint", scripts), null);
  assert.equal(fm.resolveNodeGate("run --workspace=@barwise/cli bundle", scripts), null);
  assert.equal(fm.resolveNodeGate("run does-not-exist", scripts), null);
});

test("fault-matrix refuses an npm script that chains two node gates", () => {
  // One exit code cannot be attributed to two gates, and taking the
  // first would leave the second silently unaudited -- which is the
  // class of thing this harness is for.
  assert.throws(
    () =>
      fm.resolveNodeGate("run both", {
        both: "node scripts/check-no-nul.mjs && node scripts/check-shell.mjs",
      }),
    /runs 2 node gates/,
  );
});

test("every node gate CI runs is a script that exists", () => {
  // The self-updating half of "when a new gate is added, place it under
  // the same contract": the list comes from ci.yml, so a gate added to
  // CI is in the matrix the same day. This asserts the derivation still
  // lands on real files -- a renamed script would otherwise show up as a
  // spawn failure inside a fault reading, where it reads as a finding
  // about the fault rather than a typo.
  const scripts = JSON.parse(
    readFileSync(join(REPO, "barwise", "package.json"), "utf-8"),
  ).scripts;
  const gates = fm.nodeGates(ciGates(), scripts);
  assert.ok(gates.length >= 10, `expected the node gates from ci.yml, got ${gates.length}`);
  for (const g of gates) {
    assert.ok(
      existsSync(join(REPO, "barwise", g.script)),
      `${g.name} runs ${g.script}, which does not exist`,
    );
  }
  // fmt-root only became a gate this month, and it is reached through a
  // compound npm script -- the one shape a naive parse drops.
  assert.ok(
    gates.some((g) => g.script === "scripts/fmt-root.mjs"),
    "the compound `fmt:check` script must still resolve to its node half",
  );
});

// --- barwise-984: an id names one issue, and created_at says which ---------
//
// Five collisions across three sessions. `beads-crud` mints ids from the
// highest in the LOCAL .beads/issues.jsonl, which is stale by construction
// on any branch behind main, so two branches mint the same id for unrelated
// issues. The `duplicate id` rule above catches the merged file while it
// still holds both rows; the damage happens at the RESOLUTION, where union
// by id with the later `updated_at` winning treats a collision as an edit,
// keeps one row and deletes an issue. That resolution produces a file every
// other rule accepts, because both sides are individually valid.
//
// The fixture is a throwaway repo whose `barwise/` is a SYMLINK to this
// one. The gate resolves two things from two different places: the git
// history from `git rev-parse --show-toplevel` (so the temp repo owns the
// branches, the merge base, and the tracker under test) and the Python
// interpreter from `uv run --project <root>/barwise` (so it needs a real
// pyproject and lock, which the temp repo has no business carrying). The
// symlink is what lets those be different answers.

/**
 * A throwaway repo with `main` carrying `mainRows`, and a `feature` branch
 * checked out carrying `branchRows`. Returns its path.
 */
function beadsRepo(mainRows, branchRows, { withMain = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "barwise-beadsid-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "gate@test"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "gate"], { cwd: dir });
  symlinkSync(join(REPO, "barwise"), join(dir, "barwise"));
  mkdirSync(join(dir, ".beads"), { recursive: true });
  const write = (rows) => writeFileSync(join(dir, ".beads", "issues.jsonl"), rows.join(""));
  write(mainRows);
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: dir });
  execFileSync("git", ["branch", "-M", withMain ? "main" : "trunk"], { cwd: dir });
  execFileSync("git", ["checkout", "-qb", "feature"], { cwd: dir });
  write(branchRows);
  return dir;
}

function beadsCheckIn(dir) {
  return spawnSync("bash", [join(SCRIPTS, "check-beads.sh"), "--strict"], {
    cwd: dir,
    encoding: "utf8",
  });
}

test("check-beads fails when an id names a different issue than main's", () => {
  const dir = beadsRepo(
    [issueLine({ id: "t-1", title: "main issue", created_at: "2026-01-01T00:00:00Z" })],
    [issueLine({ id: "t-1", title: "branch issue", created_at: "2026-02-02T00:00:00Z" })],
  );
  try {
    const r = beadsCheckIn(dir);
    assert.equal(r.status, 1, `expected a collision error:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /names a DIFFERENT issue on main/);
    // Both titles, because the whole point is that the reader compares them
    // before choosing a resolution -- three times the resolution was chosen
    // without ever seeing the other side's title.
    assert.match(r.stdout, /main issue/);
    assert.match(r.stdout, /branch issue/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-beads accepts an ordinary edit to an issue main also has", () => {
  // Guard the guard. `created_at` is the discriminator precisely because a
  // title, a status and a note all change legitimately; a rule keyed on any
  // of those would fail on every second commit and be turned off.
  const dir = beadsRepo(
    [issueLine({ id: "t-1", title: "before", created_at: "2026-01-01T00:00:00Z" })],
    [
      issueLine({
        id: "t-1",
        title: "after, retitled and closed",
        status: "closed",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-03-03T00:00:00Z",
      }),
    ],
  );
  try {
    const r = beadsCheckIn(dir);
    assert.equal(r.status, 0, `an edit is not a collision:\n${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stdout, /DIFFERENT issue/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-beads notes an issue that was at the merge base and is gone", () => {
  // A warning, not an error: `beads-crud delete` exists and deleting a
  // throwaway is legitimate. What is not legitimate is doing it by accident
  // while resolving a collision, which is what happened, so the reader gets
  // told which issue left and asked which of the two it was.
  const dir = beadsRepo(
    [
      issueLine({ id: "t-1", title: "kept", created_at: "2026-01-01T00:00:00Z" }),
      issueLine({ id: "t-2", title: "vanished", created_at: "2026-01-01T00:00:00Z" }),
    ],
    [issueLine({ id: "t-1", title: "kept", created_at: "2026-01-01T00:00:00Z" })],
  );
  try {
    const r = beadsCheckIn(dir);
    assert.equal(r.status, 0, `a deletion is a warning, not an error:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /'t-2' was in the tracker at the merge base and is gone/);
    assert.match(r.stdout, /vanished/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-beads says so out loud when it has no baseline to compare against", () => {
  // The rule that cannot run must not read as the rule that ran and found
  // nothing (docs/specs/gate-refusal-contract.spec.md). A warning rather
  // than a refusal because the gate's other dozen rules still answered --
  // but the line is unconditional, so the reader can tell which reading
  // they got.
  const dir = beadsRepo(
    [issueLine({ id: "t-1", title: "x", created_at: "2026-01-01T00:00:00Z" })],
    [issueLine({ id: "t-1", title: "x", created_at: "2026-01-01T00:00:00Z" })],
    { withMain: false },
  );
  try {
    const r = beadsCheckIn(dir);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /id-identity check DID NOT RUN/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- barwise-1013: the correction ratchet fails both ways ---

/**
 * A baseline that only fails on NEW records would let a fixed row sit
 * forever; one that only fails on stale rows would let a new correction
 * ship unclassified. Both halves are asserted, and both are established
 * red here rather than argued -- the gate's whole subject is that a
 * check nobody watched fail is not a check (assertion-audit rule 0).
 *
 * The probes are STAGED, not merely written: the gate enumerates through
 * `trackedFiles()`, so a spec written to disk and never `git add`ed is
 * invisible to it and the run would report a match having read nothing.
 * That is barwise-906's shape, and it is the reason this file has the
 * `stage` helper at all.
 */
function correctionRepo(specs, baselineRecords) {
  const dir = tempRepo();
  for (const [name, body] of Object.entries(specs)) {
    stage(dir, `barwise/docs/specs/${name}`, body);
  }
  stage(
    dir,
    "barwise/correction-baseline.json",
    JSON.stringify({ $comment: "test", records: baselineRecords }, null, 2) + "\n",
  );
  return dir;
}

/** The id the gate assigns, read from its own listing rather than recomputed. */
function idOf(dir, excerptFragment) {
  const listing = gate("audit-corrections.mjs", dir);
  assert.equal(listing.status, 0, `listing failed:\n${listing.stdout}${listing.stderr}`);
  const lines = listing.stdout.split("\n");
  const i = lines.findIndex((l) => l.includes(excerptFragment));
  assert.ok(i > 0, `no record matching ${excerptFragment} in:\n${listing.stdout}`);
  return lines[i - 1].trim();
}

const A_CORRECTION =
  "# Probe\n\nThe draft said the loader was pure, and implementing it showed the\n"
  + "loader reads the environment, so the claim was wrong in kind.\n";

test("audit-corrections fails on a correction record missing from the baseline", () => {
  const dir = correctionRepo({ "probe.spec.md": A_CORRECTION }, {});
  try {
    const red = gate("audit-corrections.mjs", dir, "--check");
    assert.equal(red.status, 1, `expected a finding (1), got ${red.status}`);
    assert.match(`${red.stdout}${red.stderr}`, /NEW correction record/);
    assert.match(`${red.stdout}${red.stderr}`, /probe/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audit-corrections fails on a baseline entry no longer detected", () => {
  const dir = correctionRepo({ "probe.spec.md": A_CORRECTION }, {});
  try {
    const id = idOf(dir, "the draft said the loader was pure");
    const withRow = correctionRepo({ "probe.spec.md": A_CORRECTION }, {
      [id]: { spec: "probe.spec.md", excerpt: "x", caught_by: "execution", note: "" },
    });
    try {
      assert.equal(
        gate("audit-corrections.mjs", withRow, "--check").status,
        0,
        "a classified record must pass before the stale half can mean anything",
      );
      // Rewrite the paragraph past recognition; the row now describes
      // text that is not there.
      stage(withRow, "barwise/docs/specs/probe.spec.md", "# Probe\n\nNothing here.\n");
      const red = gate("audit-corrections.mjs", withRow, "--check");
      assert.equal(red.status, 1, `expected a finding (1), got ${red.status}`);
      assert.match(`${red.stdout}${red.stderr}`, /no longer detected/);
    } finally {
      rmSync(withRow, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audit-corrections fails a row whose verdict is not a classification", () => {
  const dir = correctionRepo({ "probe.spec.md": A_CORRECTION }, {});
  try {
    const id = idOf(dir, "the draft said the loader was pure");
    const bad = correctionRepo({ "probe.spec.md": A_CORRECTION }, {
      [id]: { spec: "probe.spec.md", excerpt: "x", caught_by: "TODO: classify", note: "" },
    });
    try {
      const red = gate("audit-corrections.mjs", bad, "--check");
      assert.equal(red.status, 1, `expected a finding (1), got ${red.status}`);
      assert.match(`${red.stdout}${red.stderr}`, /no usable verdict/);
    } finally {
      rmSync(bad, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audit-corrections refuses an empty spec corpus rather than reporting a match", () => {
  // The reading that looks like success: every check filters the record
  // list, so zero specs would print "baseline matches" having read
  // nothing at all.
  const dir = tempRepo();
  try {
    stage(dir, "README.md", "no specs here\n");
    stage(dir, "barwise/correction-baseline.json", '{"records":{}}\n');
    const r = gate("audit-corrections.mjs", dir, "--check");
    assert.equal(r.status, 2, `expected refusal (2), got ${r.status}:\n${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stdout, /baseline matches/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audit-corrections refuses to WRITE a baseline while a spec is untracked", () => {
  // The defect this gate shipped with, pinned. Its own baseline was
  // generated while its own spec was unstaged: the gate enumerates
  // through trackedFiles(), so the spec was invisible, --check passed
  // locally, and CI went red on five records from that very file the
  // moment it was committed. --check still does not refuse here -- its
  // input is the TRACKED corpus by definition, the same blind spot
  // check-no-nul pins as intended -- but --write persists the
  // incomplete reading, so that is the operation that refuses.
  const dir = correctionRepo({ "tracked.spec.md": A_CORRECTION }, {});
  try {
    writeFileSync(join(dir, "barwise/docs/specs/draft.spec.md"), A_CORRECTION);

    const write = gate("audit-corrections.mjs", dir, "--write");
    assert.equal(write.status, 2, `expected refusal (2), got ${write.status}`);
    assert.match(write.stderr, /draft\.spec\.md/);
    assert.doesNotMatch(write.stdout, /wrote/);

    // --check is unaffected: the untracked draft is simply out of scope.
    const check = gate("audit-corrections.mjs", dir, "--check");
    assert.equal(check.status, 1, "the tracked probe is still unclassified, so --check finds it");
    assert.doesNotMatch(`${check.stdout}${check.stderr}`, /draft\.spec\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audit-corrections detects a marker the formatter wrapped across a line break", () => {
  // The detector matched the RAW paragraph, so `turned\nout` did not match
  // /\bturned out\b/ and the record was invisible. Twelve of the seventeen
  // markers are multi-word and dprint owns the wrapping in docs/specs, so
  // whether a correction record was detected depended on where the
  // formatter happened to break the line -- which the author does not
  // choose and cannot see in the source. Five real records across four
  // specs were being missed, two of them in gate-refusal-contract.spec.md,
  // the spec about gates that cannot see their input.
  //
  // The split is the whole test: "turned out" is the only marker in this
  // probe, and it straddles the newline. Passing it means normalisation
  // happens before matching, not after.
  const wrapped = "# Probe\n\nThe estimate of what workstream 2 touches turned\n"
    + "out to be mistaken once the packages were counted, so the figure is\n"
    + "restated here with the real set.\n";
  const dir = correctionRepo({ "probe.spec.md": wrapped }, {});
  try {
    const red = gate("audit-corrections.mjs", dir, "--check");
    assert.equal(
      red.status,
      1,
      `a wrapped marker must still be detected:\n${red.stdout}${red.stderr}`,
    );
    assert.match(`${red.stdout}${red.stderr}`, /NEW correction record/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
