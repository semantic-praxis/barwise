/**
 * Tests for .claude/hooks/session-start.sh, the web-session bootstrap.
 *
 * The hook is run for real, by bash, against a fixture project and a PATH
 * of stubs: npm, git, shellcheck and the "system" node only record what
 * they were asked, and a fake NVM_DIR stands in for the image's nvm. What
 * is under test is the Node selection (docs/specs/session-node-pin.spec.md):
 * which Node the hook ends up on, which npm command it installs with, and
 * what it persists into CLAUDE_ENV_FILE.
 *
 * The fake nvm.sh reproduces the two ways the real one failed the first
 * draft of the hook, silently and with exit 3: sourcing it returns 3 unless
 * the first argument is `--no-use` (the real one returns 3 when no default
 * Node is installed, and reads the sourcing shell's positional arguments
 * as its own). Without that, a hook that dropped `--no-use` would pass here
 * while failing on every real container.
 *
 * Lockfile preservation is asserted through the install command: the
 * degraded path must use `npm ci`, the npm command that never writes
 * package-lock.json. That the pinned npm leaves the lockfile alone is a
 * property of npm 11, measured in the spec, not of this hook.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(SCRIPTS, "..", "..");
const HOOK = join(REPO, ".claude", "hooks", "session-start.sh");
const PINNED = "26.7.0";

const roots = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function exe(path, body) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/bash\n${body}\n`);
  chmodSync(path, 0o755);
}

/**
 * A fixture: project dir with .nvmrc, a stub bin dir first on PATH, a fake
 * NVM_DIR, a HOME whose uv is already "installed", and the env file.
 * `nvm` is "ok" (installs the pinned node), "fail" (install errors), or
 * "absent" (no nvm.sh at all). `preinstalled` puts the pinned node in
 * place before the hook runs, as a resumed container has it.
 */
function fixture({ nvm = "ok", preinstalled = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "session-start-"));
  roots.push(root);
  const project = join(root, "project");
  const stubs = join(root, "stubs");
  const nvmDir = join(root, "nvm");
  const home = join(root, "home");
  const calls = join(root, "calls.log");
  const envFile = join(root, "env");
  writeFileSync(calls, "");
  writeFileSync(envFile, "");

  mkdirSync(join(project, "barwise", "scripts"), { recursive: true });
  writeFileSync(join(project, ".nvmrc"), `${PINNED}\n`);
  exe(join(project, "barwise", "scripts", "install-gitleaks.sh"), "exit 0");
  exe(join(home, ".local", "bin", "uv"), "exit 0");

  // The image's Node, first on PATH until the hook selects another.
  exe(join(stubs, "node"), `echo v22.0.0`);
  exe(join(stubs, "npm"), `echo "npm $* node=$(node --version)" >>"${calls}"`);
  exe(join(stubs, "shellcheck"), "exit 0");
  exe(
    join(stubs, "git"),
    `case "$*" in
  *"config --get core.hooksPath"*) echo barwise/.husky/_ ;;
  *"rev-parse --is-shallow-repository"*) echo false ;;
esac`,
  );

  const pinnedNode = join(nvmDir, "versions", "node", `v${PINNED}`, "bin", "node");
  if (preinstalled) exe(pinnedNode, `echo v${PINNED}`);
  if (nvm !== "absent") {
    mkdirSync(nvmDir, { recursive: true });
    const install = nvm === "ok"
      ? `mkdir -p "${
        dirname(pinnedNode)
      }"; printf '#!/bin/bash\\necho v%s\\n' "$2" >"${pinnedNode}"; chmod +x "${pinnedNode}"`
      : "return 1";
    writeFileSync(
      join(nvmDir, "nvm.sh"),
      `nvm() { echo "nvm $*" >>"${calls}"; [ "$1" = install ] || return 1; ${install}; }
[ "\${1:-}" = "--no-use" ] || return 3
`,
    );
  }
  return { root, project, stubs, nvmDir, home, calls, envFile, pinnedNode };
}

function runHook(fx, source = "startup") {
  const r = spawnSync("bash", [HOOK], {
    input: JSON.stringify({ source }),
    encoding: "utf8",
    env: {
      PATH: `${fx.stubs}:/usr/bin:/bin`,
      HOME: fx.home,
      NVM_DIR: fx.nvmDir,
      CLAUDE_CODE_REMOTE: "true",
      CLAUDE_PROJECT_DIR: fx.project,
      CLAUDE_ENV_FILE: fx.envFile,
    },
  });
  return {
    ...r,
    calls: readFileSync(fx.calls, "utf8").trim().split("\n").filter(Boolean),
    env: readFileSync(fx.envFile, "utf8").trim().split("\n").filter(Boolean),
  };
}

const npmInstallCall = (calls) => calls.find((c) => /^npm (install|ci)\b/.test(c));

test("installs the pinned Node with nvm, installs with npm install on it, and persists its PATH", () => {
  const fx = fixture();
  const r = runHook(fx);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.calls.includes(`nvm install ${PINNED}`), `nvm not asked to install: ${r.calls}`);
  assert.ok(existsSync(fx.pinnedNode), "pinned node was not installed");
  assert.equal(npmInstallCall(r.calls), `npm install --no-audit --no-fund node=v${PINNED}`);
  assert.ok(
    r.env.includes(`export PATH="${dirname(fx.pinnedNode)}:$PATH"`),
    `env file lacks the Node bin export: ${r.env}`,
  );
  assert.doesNotMatch(r.stderr, /not v26/);
});

test("a resumed container with the pin present does not reinstall it", () => {
  const fx = fixture({ preinstalled: true });
  const r = runHook(fx, "resume");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.calls.some((c) => c.startsWith("nvm ")), `nvm ran on a warm container: ${r.calls}`);
  assert.equal(npmInstallCall(r.calls), `npm install --no-audit --no-fund node=v${PINNED}`);
});

test("a failed nvm install warns and installs with npm ci, which never writes the lockfile", () => {
  const fx = fixture({ nvm: "fail" });
  const r = runHook(fx);
  assert.equal(r.status, 0, "a failed Node install must not fail the session start");
  assert.match(r.stderr, /running Node v22\.0\.0, not v26\.7\.0/);
  assert.equal(npmInstallCall(r.calls), "npm ci --no-audit --no-fund node=v22.0.0");
  assert.ok(
    !r.env.some((l) => l.includes("versions/node")),
    `persisted a Node that is not there: ${r.env}`,
  );
});

test("with no nvm at all, the hook warns and still installs with npm ci", () => {
  const fx = fixture({ nvm: "absent" });
  const r = runHook(fx);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /not v26\.7\.0 from \.nvmrc/);
  assert.equal(npmInstallCall(r.calls), "npm ci --no-audit --no-fund node=v22.0.0");
});

test("firing again (resume) does not append duplicate PATH exports", () => {
  const fx = fixture();
  runHook(fx);
  const first = readFileSync(fx.envFile, "utf8");
  const r = runHook(fx, "resume");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(fx.envFile, "utf8"), first, "env file grew on the second fire");
  assert.equal(r.env.length, 2, `expected the Node and ~/.local/bin exports once each: ${r.env}`);
});
