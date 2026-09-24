/**
 * Run the CLI bundle the way a customer would: a child process, a
 * timeout, and the exit code read back. Nothing is imported from the
 * packages, so an import that throws inside the bundle shows up here as
 * a stack trace on stderr, which is what the totality oracle wants to
 * see and grade.
 *
 * `maxBuffer` is set high on purpose: the product never sets it
 * (grep maxBuffer packages/*\/src finds nothing) and the trial must not
 * hide a large output behind the harness's own ENOBUFS.
 */
import { spawnSync } from "node:child_process";
import { CLI_BUNDLE } from "./paths.mjs";

const MAX_BUFFER = 256 * 1024 * 1024;

export function runCli(args, { cwd, timeoutMs = 600_000, env } = {}) {
  const started = process.hrtime.bigint();
  const res = spawnSync(process.execPath, [CLI_BUNDLE, ...args], {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER,
    env: { ...process.env, ...env, NO_COLOR: "1" },
  });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const timedOut = res.error?.code === "ETIMEDOUT" || res.signal === "SIGTERM";
  return {
    args,
    exit: res.status,
    signal: res.signal,
    timedOut,
    error: res.error?.message,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    ms: Math.round(ms),
  };
}

/** True when stderr carries a Node stack trace: the product crashed rather than refused. */
export function crashed(result) {
  return /\n\s+at .+\(.+:\d+:\d+\)/.test(result.stderr)
    || /TypeError|RangeError|ReferenceError/.test(result.stderr);
}
