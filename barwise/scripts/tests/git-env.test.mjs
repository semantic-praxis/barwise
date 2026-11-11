/**
 * The script tests' git runs ignore the machine's git config (barwise-j9q).
 *
 * The tests build throwaway repositories and run gates that call git. On the
 * owner's Mac a personal `lib/` rule in a global ignore file made `git add`
 * refuse inside those repositories, and the pre-push hook failed
 * test:scripts with 29 failures that CI and the container never showed.
 *
 * Each plant below is shown to break git first, under the environment it was
 * planted in, so a green reading under the isolated environment says the
 * isolation held rather than that the plant missed.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { envWithoutUserGitConfig } from "../lib/git-env.mjs";
import { scriptTestEnv } from "../lib/script-test-env.mjs";

const sandbox = mkdtempSync(join(tmpdir(), "barwise-git-env-"));
after(() => rmSync(sandbox, { recursive: true, force: true }));

let n = 0;

/**
 * A machine whose git config ignores `lib/` and sets `barwise.leak`, through
 * the one file `where` names. `env` is the environment a git command on that
 * machine would inherit: no git variable from this process, so the plant is
 * the only config there is to find.
 */
function plantedMachine(where) {
  const root = join(sandbox, `machine-${n++}`);
  const home = join(root, "home");
  const xdg = join(root, "xdg");
  mkdirSync(join(xdg, "git"), { recursive: true });
  mkdirSync(home, { recursive: true });
  const ignore = join(root, "ignore");
  writeFileSync(ignore, "lib/\n");
  const config = `[core]\n\texcludesFile = ${ignore}\n[barwise]\n\tleak = ${where}\n`;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
  );
  env.HOME = home;
  env.XDG_CONFIG_HOME = xdg;
  if (where === "global") writeFileSync(join(home, ".gitconfig"), config);
  if (where === "system") {
    const system = join(root, "gitconfig");
    writeFileSync(system, config);
    env.GIT_CONFIG_SYSTEM = system;
  }
  // git's default ignore file, read when no core.excludesFile is set.
  if (where === "xdg-ignore") writeFileSync(join(xdg, "git", "ignore"), "lib/\n");
  return env;
}

function git(cwd, env, ...args) {
  return spawnSync("git", args, { cwd, env, encoding: "utf8" });
}

/** A fresh repository holding an unstaged `lib/a`. */
function repoWithLib(env) {
  const dir = join(sandbox, `repo-${n++}`);
  mkdirSync(join(dir, "lib"), { recursive: true });
  writeFileSync(join(dir, "lib", "a"), "a\n");
  const init = git(dir, env, "init", "-q");
  assert.equal(init.status, 0, init.stderr);
  return dir;
}

for (const where of ["global", "system", "xdg-ignore"]) {
  test(`a ${where} ignore rule reaches git on the planted machine, and not under scriptTestEnv`, () => {
    const machine = plantedMachine(where);
    const exposed = git(repoWithLib(machine), machine, "add", "--", "lib/a");
    assert.notEqual(exposed.status, 0, "the plant did not reach git, so this case shows nothing");
    assert.match(exposed.stderr, /ignored by one of your \.gitignore files/);

    const isolated = scriptTestEnv(machine);
    const r = git(repoWithLib(isolated), isolated, "add", "--", "lib/a");
    assert.equal(r.status, 0, `git add refused under the isolated environment:\n${r.stderr}`);
  });
}

for (const where of ["global", "system"]) {
  test(`a ${where} config value reaches git on the planted machine, and not under scriptTestEnv`, () => {
    const machine = plantedMachine(where);
    const dir = repoWithLib(machine);
    assert.equal(git(dir, machine, "config", "--get", "barwise.leak").stdout.trim(), where);

    const r = git(dir, scriptTestEnv(machine), "config", "--get", "barwise.leak");
    assert.equal(r.status, 1, `barwise.leak still read: ${r.stdout}`);
  });
}

test("envWithoutUserGitConfig keeps the -c settings the environment already carries", () => {
  const machine = {
    ...plantedMachine("global"),
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "barwise.kept",
    GIT_CONFIG_VALUE_0: "yes",
  };
  const env = envWithoutUserGitConfig(machine);
  assert.equal(env.GIT_CONFIG_COUNT, "2");
  const dir = repoWithLib(env);
  assert.equal(git(dir, env, "config", "--get", "barwise.kept").stdout.trim(), "yes");
  assert.equal(git(dir, env, "add", "--", "lib/a").status, 0);
});

test("this run's own git reads no system or global config", () => {
  // The reading every other script test inherits. It fails under a bare
  // `node --test` on a machine with a global or system config, which is the
  // right answer there: that run is not the one CI makes. Run the file
  // through `npm run test:scripts`.
  const dir = join(sandbox, `own-${n++}`);
  mkdirSync(dir);
  assert.equal(git(dir, process.env, "init", "-q").status, 0);
  const listed = git(dir, process.env, "config", "--list", "--show-scope");
  assert.equal(listed.status, 0, listed.stderr);
  const outside = listed.stdout.split("\n").filter((l) => /^(global|system)\t/.test(l));
  assert.deepEqual(outside, [], "git config from outside the repository reached this run");
  const excludes = git(dir, process.env, "config", "--get", "core.excludesFile");
  assert.equal(excludes.status, 0, "core.excludesFile is unset, so git reads ~/.config/git/ignore");
  assert.equal(excludes.stdout.trim(), "");
});
