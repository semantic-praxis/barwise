/**
 * The exit recorder (docs/specs/masked-exit-report.spec.md).
 *
 * Not imported by anything: the SessionStart mode of masked-exit.mjs
 * base64-encodes this file into `NODE_OPTIONS=--import=data:...`, so it
 * loads into every node process a Bash command starts. A `--require` of a
 * file was rejected because a missing file makes every node command exit
 * 1, and a path with a space splits NODE_OPTIONS; an inline module has
 * neither failure. Hence it stands alone: node: builtins only.
 *
 * It records only where BARWISE_EXIT_DIR is set, and deletes it first, so
 * the first node process in a chain records and nothing it starts does:
 * `npm run x | tail` records npm, never the processes npm runs, however
 * the command is wrapped. It never writes to stdout or stderr, never
 * changes an exit code, and gives up silently if it cannot append -- a
 * failure here must not become a failure of the command it observes.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";

const base = process.env.BARWISE_EXIT_DIR;
const session = process.env.CLAUDE_CODE_SESSION_ID;
delete process.env.BARWISE_EXIT_DIR;
// No descendant can record, so none needs to load this either: drop our
// own token and keep every other option byte for byte. That saves a
// module load in every test fork and turbo task, and keeps the preload
// out of tools that reject it (vscode-test's Electron).
// Must agree with IMPORT_PREFIX in scripts/lib/exit-log.mjs; a drift
// test holds the two together, since this file cannot import it.
const IMPORT_PREFIX = "--import=data:text/javascript;base64,";
if (process.env.NODE_OPTIONS) {
  process.env.NODE_OPTIONS = process.env.NODE_OPTIONS.split(" ")
    .filter((t) => !t.startsWith(IMPORT_PREFIX)).join(" ").trim();
}

/**
 * A word safe to keep. argv is where a credential typed on a command line
 * sits (root CLAUDE.md), so nothing with `/`, `@` or `=` is ever kept.
 */
const WORD = /^[A-Za-z0-9][A-Za-z0-9_:.-]*$/;

/**
 * Only the plain `npm run <name>`, `npm test` and `npx <tool>` shapes name
 * more than the command: npm takes config flags before its subcommand, and
 * the value after a flag can be a token (`npm run --otp 123456 build`).
 */
function label() {
  // Short flags combine (`node -pe '...' arg`), so any cluster holding
  // e or p is inline code, and argv[1] is then the user's first argument.
  const inline = process.execArgv.some((a) =>
    /^(-[a-zA-Z]*[ep][a-zA-Z]*|--eval|--print)(=|$)/.test(a)
  );
  if (inline) return "node -e";
  const script = process.argv[1];
  if (!script) return "node";
  const name = basename(script);
  const args = process.argv.slice(2);
  if (/^npm(-cli)?(\.js)?$/.test(name)) {
    if ((args[0] === "run" || args[0] === "run-script") && WORD.test(args[1] ?? "")) {
      return `npm run ${args[1]}`;
    }
    return args[0] === "test" || args[0] === "t" ? "npm test" : "npm";
  }
  if (/^npx(-cli)?(\.js)?$/.test(name)) {
    return WORD.test(args[0] ?? "") ? `npx ${args[0]}` : "npx";
  }
  return WORD.test(name) ? name : "node";
}

if (base && session) {
  const what = label();
  // An EPIPE that was fatal is the reader leaving early (`| head`), not
  // the gate failing. The monitor observes without changing behaviour;
  // a listener on stdout's "error" would stop the crash it records.
  let epipe = false;
  process.on("uncaughtExceptionMonitor", (err) => {
    epipe = err?.code === "EPIPE" && err?.syscall === "write"
      && process.listenerCount("uncaughtException") === 0;
  });
  process.on("exit", (code) => {
    try {
      // Must agree with exitLogPath() in scripts/lib/exit-log.mjs; the
      // drift test in masked-exit.test.mjs runs both.
      const dir = join(base, session);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const entry = { t: Date.now(), code, label: what };
      if (epipe && code === 1) entry.epipe = true;
      appendFileSync(join(dir, "exits.jsonl"), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    } catch {
      // Never the observed command's problem.
    }
  });
}
