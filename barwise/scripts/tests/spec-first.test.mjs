/**
 * check-spec-first (docs/specs/adr-batch10-enforcers.spec.md, WS3): a pull
 * request that changes package source names a spec or carries `No spec:
 * <reason>`. A sandbox repository with the gate and its libraries copied
 * in; `main` holds a package source file and one spec, each case builds a
 * branch, and `BASE_SHA` stands in for the pull request's base.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = "barwise/packages/core/src/a.ts";

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "barwise-specfirst-"));
  const g = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      .trim();
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "t");
  mkdirSync(join(dir, "barwise", "scripts", "lib"), { recursive: true });
  cpSync(
    join(SCRIPTS, "check-spec-first.mjs"),
    join(dir, "barwise", "scripts", "check-spec-first.mjs"),
  );
  for (const l of ["args", "git-run", "name-status", "review-tiers", "spec-reader", "tracked"]) {
    cpSync(join(SCRIPTS, "lib", `${l}.mjs`), join(dir, "barwise", "scripts", "lib", `${l}.mjs`));
  }
  const write = (rel, text) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  const commit = (msg) => {
    g("add", "-A");
    g("commit", "-q", "-m", msg);
    return g("rev-parse", "HEAD");
  };
  write(SRC, "export const a = 0;\n");
  write("barwise/docs/specs/real.spec.md", "# Real\n\nStatus: Draft\n");
  const base = commit("base");
  g("checkout", "-q", "-b", "feature");
  let n = 0;
  const change = (msg = "implement") => {
    write(SRC, `export const a = ${++n};\n`);
    return commit(msg);
  };
  /** The gate with `BASE_SHA` the base; an `undefined` value unsets that variable. */
  const run = (env = {}, root = dir) => {
    const e = { ...process.env, BASE_SHA: base, ...env };
    for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
    return spawnSync(
      process.execPath,
      [join(root, "barwise", "scripts", "check-spec-first.mjs")],
      { cwd: root, encoding: "utf8", env: e },
    );
  };
  return {
    dir,
    write,
    commit,
    change,
    run,
    ci: (body) => ({ GITHUB_ACTIONS: "true", PR_BODY: body }),
    local: { GITHUB_ACTIONS: undefined, PR_BODY: undefined },
  };
}

function withSandbox(fn) {
  const s = sandbox();
  try {
    fn(s);
  } finally {
    rmSync(s.dir, { recursive: true, force: true });
  }
}

test("package source changed, body and commits silent, in CI -> 1", () =>
  withSandbox((s) => {
    s.change();
    const out = s.run(s.ci("Fixes a thing."));
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /barwise\/packages\/core\/src\/a\.ts/);
    assert.doesNotMatch(out.stdout, /OK/);
  }));

test("an empty body in CI is a body that names nothing -> 1, not a refusal", () =>
  withSandbox((s) => {
    s.change();
    assert.equal(s.run(s.ci("")).status, 1);
  }));

test("a spec file name in the body passes", () =>
  withSandbox((s) => {
    s.change();
    const out = s.run(s.ci("Implements real.spec.md, workstream 1."));
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /OK.*real\.spec\.md/);
  }));

test("a body naming a spec that is in no corpus -> 1", () =>
  withSandbox((s) => {
    s.change();
    assert.equal(s.run(s.ci("Implements nothing.spec.md")).status, 1);
  }));

test("a spec file name in a commit message passes with a silent body", () =>
  withSandbox((s) => {
    s.change("real.spec.md WS1: implement");
    assert.equal(s.run(s.ci("")).status, 0);
  }));

test("a diff that changes a spec counts as naming it", () =>
  withSandbox((s) => {
    s.write("barwise/docs/specs/real.spec.md", "# Real\n\nStatus: Draft\n\nEdited.\n");
    s.change();
    assert.equal(s.run(s.ci("")).status, 0);
  }));

test("a `No spec: <reason>` line passes, in the body or in a commit message", () => {
  withSandbox((s) => {
    s.change();
    assert.equal(s.run(s.ci("Summary\n\nNo spec: a typo in a message\n")).status, 0);
    assert.equal(s.run(s.ci("Summary\r\nNo spec: crlf body\r\n")).status, 0);
  });
  withSandbox((s) => {
    s.change("fix\n\nNo spec: one-line fix");
    assert.equal(s.run(s.ci("")).status, 0);
  });
});

test("`No spec:` with no reason -> 1", () =>
  withSandbox((s) => {
    s.change();
    for (const body of ["No spec:", "No spec:   \n", "No spec:\nreason on the next line"]) {
      assert.equal(s.run(s.ci(body)).status, 1, JSON.stringify(body));
    }
  }));

test("`No spec:` must start a line", () =>
  withSandbox((s) => {
    s.change();
    assert.equal(s.run(s.ci("This is prose, No spec: x")).status, 1);
  }));

test("no package source changed -> 0 whatever the body says", () =>
  withSandbox((s) => {
    s.write("barwise/docs/notes.md", "x\n");
    s.write("barwise/scripts/other.mjs", "x\n");
    s.commit("docs and scripts");
    const out = s.run(s.ci(""));
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /no package source changed/);
  }));

test("a package test or config file is not package source", () =>
  withSandbox((s) => {
    s.write("barwise/packages/core/tests/a.test.ts", "x\n");
    s.write("barwise/packages/core/package.json", "{}\n");
    s.commit("tests only");
    assert.equal(s.run(s.ci("")).status, 0);
  }));

test("PR_BODY unset with GITHUB_ACTIONS set -> 2", () =>
  withSandbox((s) => {
    s.change();
    const out = s.run({ GITHUB_ACTIONS: "true", PR_BODY: undefined });
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(out.stderr, /PR_BODY/);
    assert.doesNotMatch(out.stdout, /OK/);
  }));

test("PR_BODY unset in CI refuses even when no package source changed", () =>
  withSandbox((s) => {
    s.write("barwise/docs/notes.md", "x\n");
    s.commit("docs only");
    assert.equal(s.run({ GITHUB_ACTIONS: "true", PR_BODY: undefined }).status, 2);
  }));

test("a local run with silent commits -> 0 saying NOT CHECKED, never OK", () =>
  withSandbox((s) => {
    s.change();
    const out = s.run(s.local);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /NOT CHECKED -- no pull request body in a local run; CI reads it/);
    assert.doesNotMatch(out.stdout, /OK/);
  }));

test("a local run whose commits name a spec passes with OK", () =>
  withSandbox((s) => {
    s.change("real.spec.md: implement");
    const out = s.run(s.local);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /OK/);
  }));

test("a PR_BODY given locally is read as in CI", () =>
  withSandbox((s) => {
    s.change();
    assert.equal(s.run({ ...s.local, PR_BODY: "nothing" }).status, 1);
    assert.equal(s.run({ ...s.local, PR_BODY: "real.spec.md" }).status, 0);
  }));

test("a shallow clone refuses in both modes", () =>
  withSandbox((s) => {
    s.change();
    const shallow = mkdtempSync(join(tmpdir(), "barwise-specfirst-shallow-"));
    try {
      execFileSync("git", [
        "clone",
        "-q",
        "--depth",
        "1",
        "--branch",
        "feature",
        `file://${s.dir}`,
        shallow,
      ], { stdio: "ignore" });
      for (const env of [s.local, s.ci("real.spec.md")]) {
        const out = s.run({ ...env, BASE_SHA: "HEAD" }, shallow);
        assert.equal(out.status, 2, out.stdout + out.stderr);
        assert.match(out.stderr, /shallow clone/);
        assert.doesNotMatch(out.stdout, /OK|NOT CHECKED/);
      }
    } finally {
      rmSync(shallow, { recursive: true, force: true });
    }
  }));

test("an unresolvable base refuses in both modes, before the body is read", () =>
  withSandbox((s) => {
    s.change();
    for (const env of [s.local, s.ci("")]) {
      const out = s.run({ ...env, BASE_SHA: "0".repeat(40) });
      assert.equal(out.status, 2, out.stdout + out.stderr);
    }
  }));
