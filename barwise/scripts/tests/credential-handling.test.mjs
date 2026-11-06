/**
 * docs/adr/credential-handling.md, held by tests that need no gitleaks
 * (docs/specs/credential-handling-held.spec.md). Each property is literal
 * text in a tracked file or the wrapper's behaviour against a stand-in,
 * so these run, and never skip, whether or not gitleaks is installed.
 * The staged-probe tests in gates.test.mjs, which need the real scanner,
 * stay where they are.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPTS = join(REPO, "barwise", "scripts");
const read = (path) => readFileSync(join(REPO, path), "utf8");

/** Shell or YAML text with comments stripped and quoted strings blanked. */
function code(text) {
  return text.split("\n").map((line) =>
    line.replace(/"[^"]*"|'[^']*'/g, '""').replace(/(^|\s)#.*$/, "$1")
  );
}

/**
 * The TOML tables of `.gitleaks.toml`, as [header, {key: value}] pairs.
 * The file uses two forms only, table headers and `key = value` lines; any
 * other line throws, so a form this reader cannot read fails the test
 * instead of being passed over.
 */
function tomlTables(text) {
  const tables = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const header = /^(\[\[?)([\w.]+)\]\]?$/.exec(line);
    if (header) {
      tables.push([header[1] === "[[" ? `[[${header[2]}]]` : `[${header[2]}]`, {}]);
      continue;
    }
    const kv = /^([\w-]+)\s*=\s*(.+)$/.exec(line);
    if (!kv || tables.length === 0) {
      throw new Error(`.gitleaks.toml: a line this reader cannot read: ${line}`);
    }
    tables.at(-1)[1][kv[1]] = kv[2];
  }
  return tables;
}

test("`.gitleaks.toml` extends the default rules and adds exactly one, for Anthropic keys [adr:credential-handling#gitleaks-detects]", () => {
  const tables = tomlTables(read(".gitleaks.toml"));
  const extend = tables.filter(([h]) => h === "[extend]");
  assert.equal(extend.length, 1, "one [extend] table");
  assert.equal(extend[0][1].useDefault, "true", "[extend] useDefault = true");
  const rules = tables.filter(([h]) => h === "[[rules]]");
  assert.equal(rules.length, 1, `exactly one local rule, found ${rules.length}`);
  assert.equal(rules[0][1].id, '"anthropic-api-key"');
  assert.deepEqual(tables.map(([h]) => h).sort(), ["[[rules]]", "[extend]"], "no other table");
});

test("the TOML reader refuses a form it cannot read rather than passing it over", () => {
  assert.throws(() => tomlTables("[extend]\nuseDefault = true\n{ inline = 1 }\n"), /cannot read/);
});

test("CI scans the full history with no skip, and pre-commit scans the index [adr:credential-handling#scan-index-and-history]", () => {
  const ci = parse(read(".github/workflows/ci.yml"));
  const found = [];
  for (const job of Object.values(ci.jobs)) {
    for (const step of job.steps ?? []) {
      if (/\bnpm run check:secrets\b/.test(step.run ?? "")) found.push({ job, step });
    }
  }
  assert.equal(found.length, 1, "exactly one CI step runs check:secrets");
  const [{ job, step }] = found;
  assert.equal(step.if, undefined, "the check:secrets step has no if: (no docs-only skip)");
  assert.equal(
    step["continue-on-error"],
    undefined,
    "the check:secrets step cannot be non-blocking",
  );
  assert.doesNotMatch(step.run, /--staged/, "CI scans history, not the index");
  const checkout = (job.steps ?? []).find((s) => /^actions\/checkout@/.test(s.uses ?? ""));
  assert.equal(checkout?.with?.["fetch-depth"], 0, "the job checks out full history");

  const hook = code(read("barwise/.husky/pre-commit")).map((l) => l.trim());
  assert.ok(
    hook.includes("sh scripts/hooks/check-staged-secrets.sh || exit $?"),
    "pre-commit runs the staged scan and stops on its status",
  );
  const staged = code(read("barwise/scripts/hooks/check-staged-secrets.sh")).join("\n");
  assert.match(staged, /npm run --silent check:secrets -- --staged\n\s*status=\$\?/);
  assert.match(
    read("barwise/scripts/hooks/check-staged-secrets.sh"),
    /^exit "\$\{status\}"$/m,
    "a refusal's status passes through",
  );
});

/** A throwaway repository with this repository's `.gitleaks.toml` committed. */
function secretsRepo() {
  const dir = mkdtempSync(join(tmpdir(), "barwise-cred-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "t");
  writeFileSync(join(dir, ".gitleaks.toml"), read(".gitleaks.toml"));
  git("add", ".gitleaks.toml");
  git("commit", "-qm", "base");
  return dir;
}

/**
 * The wrapper against a stand-in gitleaks. PATH is the stand-in plus
 * /usr/bin and /bin only: Node's spawn skips a file it cannot execute and
 * keeps searching, so with the usual PATH a real gitleaks would answer
 * instead (spec, plan review).
 */
function withStandIn(t, script, ...args) {
  const repo = secretsRepo();
  const bin = mkdtempSync(join(tmpdir(), "barwise-gl-"));
  t.after(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(bin, { recursive: true, force: true });
  });
  writeFileSync(join(bin, "gitleaks"), script(bin));
  chmodSync(join(bin, "gitleaks"), 0o755);
  const r = spawnSync(process.execPath, [join(SCRIPTS, "check-secrets.mjs"), ...args], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
  });
  return { r, bin, repo };
}

test("the wrapper refuses when gitleaks is present but cannot be executed [adr:credential-handling#wrapper-contract]", (t) => {
  // Answers `version`, then takes away every execute bit (root can run a
  // file any x bit remains on), so the scan's own spawn fails.
  const { r, bin } = withStandIn(
    t,
    (dir) => `#!/bin/sh\necho ran > "${dir}/version-ran"\nchmod a-x "$0"\necho 8.28.0\n`,
    "--staged",
  );
  assert.ok(existsSync(join(bin, "version-ran")), "the stand-in, not a real gitleaks, answered");
  assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /gitleaks could not be executed/);
  assert.doesNotMatch(r.stdout, /OK/);
});

test("the wrapper always passes --redact, --verbose and the repository's config, and --staged only when asked [adr:credential-handling#wrapper-contract]", (t) => {
  const record = (dir) =>
    `#!/bin/sh\nif [ "$1" = version ]; then echo 8.28.0; exit 0; fi\nprintf '%s\\n' "$@" > "${dir}/argv"\nexit 0\n`;
  for (const staged of [true, false]) {
    const { r, bin, repo } = withStandIn(t, record, ...(staged ? ["--staged"] : []));
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    const argv = readFileSync(join(bin, "argv"), "utf8").trim().split("\n");
    for (const flag of ["--redact", "--verbose", "--no-banner"]) {
      assert.ok(argv.includes(flag), `${flag} in ${argv}`);
    }
    const config = argv[argv.indexOf("--config") + 1];
    assert.equal(
      config,
      join(
        execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: repo, encoding: "utf8" })
          .trim(),
        ".gitleaks.toml",
      ),
    );
    assert.equal(argv.includes("--staged"), staged);
  }
});

test("CI and the session hook get gitleaks only from install-gitleaks.sh [adr:credential-handling#pinned-gitleaks]", () => {
  for (const file of [".github/workflows/ci.yml", ".claude/hooks/session-start.sh"]) {
    assert.match(read(file), /install-gitleaks\.sh/, `${file} calls the installer`);
    // An allowlist, not a list of banned forms: a `uses:` action, `go
    // install`, a docker image or a package manager all fail unnamed.
    for (const [i, line] of code(read(file)).entries()) {
      if (!/gitleaks/i.test(line)) continue;
      const allowed = /install-gitleaks\.sh/.test(line) || /^\s*-?\s*name:/.test(line);
      assert.ok(allowed, `${file}:${i + 1} gets gitleaks some other way: ${line.trim()}`);
    }
  }
});

test("the installer checks the digest before it unpacks anything [adr:credential-handling#pinned-gitleaks]", (t) => {
  const bin = mkdtempSync(join(tmpdir(), "barwise-inst-"));
  const target = mkdtempSync(join(tmpdir(), "barwise-inst-to-"));
  t.after(() => {
    rmSync(bin, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  });
  // curl writes bytes no digest matches; tar records that it ran. PATH has
  // no gitleaks, so the installer does not stop at "already present".
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ "$1" = -o ]; then shift; echo junk > "$1"; fi; shift; done\necho ran > "${bin}/curl-ran"\n`,
  );
  writeFileSync(join(bin, "tar"), `#!/bin/sh\necho ran > "${bin}/tar-ran"\n`);
  chmodSync(join(bin, "curl"), 0o755);
  chmodSync(join(bin, "tar"), 0o755);
  const r = spawnSync("/bin/bash", [join(SCRIPTS, "install-gitleaks.sh"), target], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
  });
  assert.ok(
    existsSync(join(bin, "curl-ran")),
    `the installer reached the download:\n${r.stdout}${r.stderr}`,
  );
  assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /CHECKSUM MISMATCH/);
  assert.ok(
    !existsSync(join(bin, "tar-ran")),
    "nothing was unpacked before the digest was checked",
  );
  assert.ok(!existsSync(join(target, "gitleaks")), "nothing was installed");
});
