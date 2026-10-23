/**
 * The exit recorder and the masked-exit hooks
 * (docs/specs/masked-exit-report.spec.md, barwise-40a). The recorder is
 * driven as the shell drives it -- real processes under the inlined
 * NODE_OPTIONS -- and the hooks as Claude Code does, JSON on stdin. Every
 * fixture has its own TMPDIR, BARWISE_EXIT_DIR and session id, so running
 * this suite inside a session never touches that session's log.
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
import { acceptsImport, envLines, exitLogPath, mergeEnvFile } from "../lib/exit-log.mjs";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = join(SCRIPTS, "hooks", "masked-exit.mjs");
const RECORDER = join(SCRIPTS, "hooks", "exit-recorder.mjs");
const SETTINGS = join(SCRIPTS, "..", "..", ".claude", "settings.json");
const SID = "fixture-session";

/** A fresh fixture: a temp dir standing in for TMPDIR, and the paths in it. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "barwise-masked-"));
  const base = join(dir, "barwise-exit");
  const log = exitLogPath(base, SID);
  const clean = { ...process.env };
  for (
    const k of ["BARWISE_EXIT_DIR", "CLAUDE_CODE_SESSION_ID", "NODE_OPTIONS", "CLAUDE_ENV_FILE"]
  ) {
    delete clean[k];
  }
  const b64 = Buffer.from(readFileSync(RECORDER, "utf8")).toString("base64");
  const armed = {
    ...clean,
    BARWISE_EXIT_DIR: base,
    CLAUDE_CODE_SESSION_ID: SID,
    NODE_OPTIONS: `--import=data:text/javascript;base64,${b64}`,
  };
  /** Run a Bash command the way the Bash tool would, armed. */
  const sh = (cmd, env = armed) =>
    spawnSync("bash", ["-c", cmd], { cwd: dir, env, encoding: "utf8" });
  /** Run a hook mode the way Claude Code would. */
  const hook = (mode, input = {}) =>
    spawnSync(process.execPath, [HOOK, mode], {
      input: typeof input === "string" ? input : JSON.stringify({ session_id: SID, ...input }),
      env: { ...clean, TMPDIR: dir },
      encoding: "utf8",
    });
  const entries = () =>
    existsSync(log)
      ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : [];
  const done = () => rmSync(dir, { recursive: true, force: true });
  return { dir, base, log, clean, armed, sh, hook, entries, done };
}

/** A post hook after a call that exited 0. */
const post = (f, command = "npm test") => f.hook("post", { tool_input: { command } });

test("the barwise-40a shapes are reported after a call that exited 0", () => {
  const f = fixture();
  try {
    writeFileSync(
      join(f.dir, "package.json"),
      JSON.stringify({ scripts: { bad: 'node -e "process.exit(1)"' } }),
    );
    writeFileSync(join(f.dir, "hook.sh"), "npm run bad\n");
    const cases = [
      // mutate refusing with 2 behind tail
      ["node -e 'process.exit(2)' | tail -1; echo $?", /node -e\s+exit 2/],
      // the test:scripts shape: npm's status is the script's
      ["npm run bad 2>&1 | tail -1", /npm run bad\s+exit 1/],
      // barwise-906: the pre-push hook read through PIPESTATUS[0], echo's
      ["echo | sh hook.sh 2>/dev/null | tail -1; echo ${PIPESTATUS[0]}", /npm run bad\s+exit 1/],
      ["node -e 'process.exit(1)' > log; tail log", /node -e\s+exit 1/],
      ["node -e 'process.exit(1)' || true", /node -e\s+exit 1/],
      ["cd \"$(node -e 'process.exit(1)')\"; true", /node -e\s+exit 1/],
    ];
    for (const [cmd, want] of cases) {
      const run = f.sh(cmd);
      assert.equal(run.status, 0, `${cmd} must itself exit 0 for the case to mean anything`);
      const r = post(f);
      assert.equal(r.status, 2, `${cmd}: ${r.stderr}`);
      assert.match(r.stderr, want, cmd);
      assert.match(r.stderr, /the command still reported 0/);
    }
  } finally {
    f.done();
  }
});

test("the failure mode lists every non-zero exit it reads, never silent", () => {
  const f = fixture();
  try {
    f.sh("node -e 'process.exit(1)'");
    let r = f.hook("failure", {
      tool_input: { command: "npm run lint" },
      error: "Exit code 1\nlint failed",
    });
    assert.equal(r.status, 2, "a plain visible failure is listed, in one line, not judged");
    assert.match(r.stderr, /Non-zero exits read with this call \(its status: exit 1\)/);
    assert.match(r.stderr, /node -e\s+exit 1/);
    assert.doesNotMatch(r.stderr, /still reported 0/);
    // Two failures, and a code that differs from the call's (git push).
    f.sh("node -e 'process.exit(2)' | tail; node -e 'process.exit(1)'");
    r = f.hook("failure", { error: "Exit code 1" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /exit 2[\s\S]*exit 1/);
    // An unparsable error still lists what it read.
    f.sh("node -e 'process.exit(5)'");
    r = f.hook("failure", { error: "something else" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /its status: unknown/);
  } finally {
    f.done();
  }
});

test("each entry is reported once, by the next call to end", () => {
  const f = fixture();
  try {
    // A background failure that exited between calls.
    f.sh("node -e 'process.exit(1)'");
    assert.equal(post(f).status, 2);
    const again = post(f);
    assert.equal(again.status, 0, `already read: ${again.stderr}`);
    assert.equal(again.stderr, "");
  } finally {
    f.done();
  }
});

test("a fatal EPIPE is a closed pipe, not a failure; a survived one is a failure", () => {
  const f = fixture();
  try {
    // Bounded: an endless synchronous loop never yields to the EPIPE error.
    f.sh("node -e 'for(let i=0;i<1e5;i++)process.stdout.write(\"x\\n\")' | head -1 >/dev/null");
    let r = post(f);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /node -e: stopped by a closed pipe/);
    assert.doesNotMatch(r.stderr, /still reported 0/);
    f.sh(
      'node -e \'process.on("uncaughtException",()=>process.exit(1));'
        + 'for(let i=0;i<1e5;i++)process.stdout.write("x\\n")\' | head -1 >/dev/null',
    );
    r = post(f);
    assert.match(r.stderr, /node -e\s+exit 1/, "a handled EPIPE is an ordinary exit");
  } finally {
    f.done();
  }
});

test("only the first node process records, and opted-out commands record nothing", () => {
  const f = fixture();
  try {
    f.sh(
      'node -e \'try{require("child_process").execFileSync(process.execPath,["-e","process.exit(3)"])}catch{}\'',
    );
    assert.deepEqual(f.entries().map((e) => e.code), [0], "the child's exit 3 is not recorded");
    f.sh("unset BARWISE_EXIT_DIR; node -e 'process.exit(1)' | tail");
    f.sh("env -u BARWISE_EXIT_DIR node -e 'process.exit(1)'");
    assert.equal(f.entries().length, 1, "unset and env -u (how every hook runs) record nothing");
  } finally {
    f.done();
  }
});

test("the read survives a bad line, waits for a torn one, and restarts on a shorter log", () => {
  const f = fixture();
  try {
    mkdirSync(dirname(f.log), { recursive: true });
    writeFileSync(f.log, `garbage\n${JSON.stringify({ t: 1, code: 1, label: "x" })}\n`);
    let r = post(f);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /1 unreadable exit-log entry/);
    assert.match(r.stderr, /x\s+exit 1/, "the entry after the bad line is still read");
    // A torn line is left for the next read.
    writeFileSync(
      f.log,
      readFileSync(f.log, "utf8") + JSON.stringify({ t: 2, code: 4, label: "y" }),
    );
    r = post(f);
    assert.equal(r.status, 0, r.stderr);
    writeFileSync(f.log, readFileSync(f.log, "utf8") + "\n");
    r = post(f);
    assert.match(r.stderr, /y\s+exit 4/);
    // Removed and recreated: shorter than the read position.
    writeFileSync(f.log, `${JSON.stringify({ t: 3, code: 6, label: "z" })}\n`);
    r = post(f);
    assert.match(r.stderr, /z\s+exit 6/);
  } finally {
    f.done();
  }
});

test("nothing non-zero, or no log at all, is silent", () => {
  const f = fixture();
  try {
    let r = post(f, "ls");
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
    f.sh("node -e 'process.exit(0)'");
    r = post(f);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
  } finally {
    f.done();
  }
});

test("a recorder that never records is said once, after three node commands", () => {
  const f = fixture();
  try {
    for (let i = 0; i < 3; i++) assert.equal(post(f, "grep npm package.json").status, 0);
    assert.equal(post(f, "npm test").status, 0);
    assert.equal(
      f.hook("failure", { tool_input: { command: "cd x && npx vitest run" }, error: "Exit code 1" })
        .status,
      0,
    );
    const third = post(f, "node a.mjs | tail");
    assert.equal(third.status, 2, "failing calls count too");
    assert.match(third.stderr, /exit recorder is not recording/);
    assert.equal(post(f, "npm test").status, 0, "once per session");
  } finally {
    f.done();
  }
});

test("a report mode that cannot answer says so to the model", () => {
  const f = fixture();
  try {
    const r = f.hook("post", "not json");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /could not answer -- no session_id/);
  } finally {
    f.done();
  }
});

test("the Stop mode holds the turn open once over an unread failure", () => {
  const f = fixture();
  try {
    f.sh("node -e 'process.exit(1)' &");
    // Background: wait for the entry rather than for a fixed time.
    for (let i = 0; i < 200 && f.entries().length === 0; i++) spawnSync("sleep", ["0.05"]);
    let r = f.hook("stop", { stop_hook_active: false });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Before this turn ends/);
    r = f.hook("stop", { stop_hook_active: true });
    assert.equal(r.status, 0, r.stderr);
  } finally {
    f.done();
  }
});

test("labels keep only words that cannot carry a value", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, "npm-cli.js"), "process.exit(1)\n");
    writeFileSync(join(f.dir, "npx-cli.js"), "process.exit(1)\n");
    writeFileSync(join(f.dir, "tok=SECRET3.js"), "process.exit(1)\n");
    const cases = [
      ["node npm-cli.js --//registry.npmjs.org/:_authToken=SECRET1 whoami", "npm"],
      ["node npm-cli.js run --otp 123456 build", "npm"],
      ["node npx-cli.js --registry https://u:SECRET2@h vitest", "npx"],
      ["node npm-cli.js run build", "npm run build"],
      ["node npm-cli.js test", "npm test"],
      ["node npx-cli.js vitest run", "npx vitest"],
      ["node tok=SECRET3.js", "node"],
    ];
    for (const [cmd] of cases) f.sh(cmd);
    assert.deepEqual(f.entries().map((e) => e.label), cases.map(([, want]) => want));
    assert.doesNotMatch(readFileSync(f.log, "utf8"), /SECRET|123456/);
  } finally {
    f.done();
  }
});

test("a recorder that cannot write leaves the command's output and status alone", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.dir, "not-a-dir"), "");
    const run = f.sh("node -e 'console.log(\"hi\"); process.exit(3)'", {
      ...f.armed,
      BARWISE_EXIT_DIR: join(f.dir, "not-a-dir"),
    });
    assert.equal(run.status, 3);
    assert.equal(run.stdout, "hi\n");
    assert.equal(run.stderr, "");
  } finally {
    f.done();
  }
});

test("the recorder and exit-log.mjs agree on the log path", () => {
  const f = fixture();
  try {
    f.sh("node -e 0");
    assert.ok(existsSync(exitLogPath(f.base, SID)), "the recorder wrote where the hooks read");
  } finally {
    f.done();
  }
});

test("the SessionStart mode writes two lines once, replacing a stale recorder", () => {
  const f = fixture();
  try {
    const envFile = join(f.dir, "env.sh");
    writeFileSync(
      envFile,
      'export PATH="/x:$PATH"\nexport NODE_OPTIONS="--import=data:text/javascript;base64,OLD"\n',
    );
    const run = () =>
      spawnSync(process.execPath, [HOOK, "session"], {
        input: "{}",
        env: { ...f.clean, TMPDIR: f.dir, CLAUDE_ENV_FILE: envFile },
        encoding: "utf8",
      });
    for (let i = 0; i < 3; i++) assert.equal(run().status, 0);
    const lines = readFileSync(envFile, "utf8").trim().split("\n");
    assert.equal(lines.length, 3, lines.join("\n"));
    assert.equal(lines[0], 'export PATH="/x:$PATH"');
    assert.equal(lines[1], `export BARWISE_EXIT_DIR="${f.base}"`);
    assert.ok(
      lines[2].endsWith('${NODE_OPTIONS:+ $NODE_OPTIONS}"'),
      "an existing NODE_OPTIONS survives",
    );
    assert.doesNotMatch(lines[2], /,OLD/);
    // A copy of the hook with no recorder beside it writes nothing.
    const bare = join(f.dir, "bare");
    mkdirSync(join(bare, "hooks"), { recursive: true });
    cpSync(HOOK, join(bare, "hooks", "masked-exit.mjs"));
    cpSync(join(SCRIPTS, "lib"), join(bare, "lib"), { recursive: true });
    const before = readFileSync(envFile, "utf8");
    const r = spawnSync(process.execPath, [join(bare, "hooks", "masked-exit.mjs"), "session"], {
      input: "{}",
      env: { ...f.clean, TMPDIR: f.dir, CLAUDE_ENV_FILE: envFile },
      encoding: "utf8",
    });
    assert.equal(r.status, 1);
    assert.equal(readFileSync(envFile, "utf8"), before);
  } finally {
    f.done();
  }
});

test("end to end: the written env file, inlined as the harness does, arms the recorder", () => {
  const f = fixture();
  try {
    const envFile = join(f.dir, "env.sh");
    const s = spawnSync(process.execPath, [HOOK, "session"], {
      input: "{}",
      env: { ...f.clean, TMPDIR: f.dir, CLAUDE_ENV_FILE: envFile, NODE_OPTIONS: "" },
      encoding: "utf8",
    });
    assert.equal(s.status, 0, s.stderr);
    // The harness prefixes the env file's text to each command line.
    const cmd = `${readFileSync(envFile, "utf8")}node -e 'process.exit(1)' | tail -1`;
    const run = f.sh(cmd, {
      ...f.clean,
      CLAUDE_CODE_SESSION_ID: SID,
      NODE_OPTIONS: "--max-old-space-size=512",
    });
    assert.equal(run.status, 0, run.stderr);
    const r = post(f);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /node -e\s+exit 1/);
  } finally {
    f.done();
  }
});

test("only node 20.6 and later get the --import line", () => {
  for (const v of ["20.6.0", "20.11.1", "22.0.0", "26.7.0"]) {
    assert.equal(acceptsImport(v), true, v);
  }
  for (const v of ["18.19.0", "20.5.1", "16.20.2"]) assert.equal(acceptsImport(v), false, v);
});

test("the env merge keeps unrelated lines and replaces only ours", () => {
  const merged = mergeEnvFile(
    'export A=1\nexport BARWISE_EXIT_DIR="/old"\n',
    envLines("/new", "x"),
  );
  assert.match(merged, /^export A=1\nexport BARWISE_EXIT_DIR="\/new"\nexport NODE_OPTIONS=/);
  assert.equal(merged.split("\n").filter(Boolean).length, 3);
});

test("the wiring: four entries, right matchers, every hook command without the switch", () => {
  const { hooks } = JSON.parse(readFileSync(SETTINGS, "utf8"));
  const find = (event, mode) =>
    (hooks[event] ?? []).find((e) =>
      e.hooks.some((h) => h.command.includes(`masked-exit.mjs" ${mode}`))
    );
  for (
    const [event, mode, matcher] of [
      ["SessionStart", "session", ""],
      ["PostToolUse", "post", "Bash"],
      ["PostToolUseFailure", "failure", "Bash"],
      ["Stop", "stop", ""],
    ]
  ) {
    const entry = find(event, mode);
    assert.ok(entry, `${event} runs masked-exit.mjs ${mode}`);
    assert.equal(entry.matcher, matcher, `${event} matcher`);
  }
  const commands = Object.values(hooks).flat().flatMap((e) => e.hooks.map((h) => h.command));
  for (const c of commands) {
    assert.ok(
      c.startsWith("env -u BARWISE_EXIT_DIR "),
      `a hook must never record its own exit: ${c}`,
    );
  }
});
