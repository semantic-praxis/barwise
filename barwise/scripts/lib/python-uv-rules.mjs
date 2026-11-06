/**
 * What counts as running Python outside the lockfile, as text in a
 * command. Shared by `check-python-uv.mjs` (tracked files) and
 * `hooks/python-uv-guard.mjs` (the commands an agent runs), which must
 * refuse the same things (agent-python-uv-hook.spec.md). The reasons for
 * each rule are in check-python-uv.mjs's header.
 */

/** Interpreter names, refusing `python-version` and `.python-version`. */
export const INTERPRETER = String.raw`(?:python3|python|pip3|pip)(?![\w.-])`;

/**
 * Commands that run their argument as a command, so `timeout 60 python3`
 * is a bare interpreter as surely as `python3` is. Each wrapper's own
 * options and operands are skipped first: `env -i FOO=1 python3`,
 * `nice -n 5 python3` and `timeout -s KILL 60 python3` each got past a
 * pattern that allowed the wrapper's name alone (PR #575 review).
 */
const WRAPPER = String.raw`(?:(?:${
  [
    String.raw`env(?:\s+(?:-\S+|[A-Za-z_]\w*=\S*))*`,
    String.raw`exec(?:\s+-\S+)*`,
    String.raw`time(?:\s+-\S+)*`,
    "nohup",
    String.raw`nice(?:\s+(?:-n\s+\S+|-\S+))*`,
    String.raw`timeout(?:\s+(?:-[sk]\s+\S+|-\S+))*\s+\S+`,
  ].join("|")
})\s+)*`;

/** A command position in a shell line: start, or after a separator. */
const COMMAND_POS = new RegExp(
  String
    .raw`(?:^|[;&|(]|&&|\|\||\$\()\s*(?:[A-Za-z_]\w*=\S*\s+)*${WRAPPER}(${INTERPRETER})`,
);

/**
 * Matched as prefixes of an option uv receives, most specific first:
 * `--with` also catches `--with-editable`, which layers packages "allowed
 * to conflict" with the project's, and which the substring check this
 * replaced caught only by accident (python-uv-widened WS1). `-w` is
 * `--with`'s short form.
 */
const BANNED_UV_FLAGS = [
  ["--with-requirements", "reads requirements outside the lockfile"],
  ["--with", "resolves against the index, not uv.lock -- a lock bypass"],
  ["-w", "`--with`'s short form -- a lock bypass"],
  ["--isolated", "resolves outside the project entirely"],
  ["--no-project", "runs with no project, so no lock -- --isolated by another name"],
];

/** `uvx` and `uv tool run` resolve a tool from the index, never uv.lock. */
/**
 * Blank the contents of quoted strings before matching a command, so an
 * `echo "== uv sync"` heading is not read as an invocation. A genuine
 * `bash -c "python3 ..."` is missed in exchange; flagging every mention
 * instead makes a gate cry wolf on its own error messages.
 */
export function blankQuoted(line) {
  // Newlines survive, so a string spanning lines keeps the line count.
  return line.replace(/"[^"]*"|'[^']*'/g, (m) => m.replace(/[^\n]/g, m[0]));
}

/** Join `\`-continued shell lines, so a flag on line 2 counts as line 1's. */
export function logicalLines(text) {
  const out = [];
  let buf = "";
  let start = 0;
  text.split("\n").forEach((raw, i) => {
    if (buf === "") start = i + 1;
    if (raw.endsWith("\\")) {
      buf += raw.slice(0, -1) + " ";
      return;
    }
    out.push({ line: start, text: buf + raw });
    buf = "";
  });
  if (buf !== "") out.push({ line: start, text: buf });
  return out;
}

/** The bare interpreter a shell line runs in command position, or null. */
export function bareInterpreter(cmd) {
  return COMMAND_POS.exec(cmd)?.[1] ?? null;
}

/**
 * A line with its comment removed, cut into the commands a shell runs
 * separately. Quotes must already be blanked, so a separator or `#`
 * inside a string is not seen. `start` is each command's offset in the
 * line, so a caller can recover its raw text.
 */
export function commandSegments(cmd) {
  const code = cmd.replace(/(^|\s)#.*$/, "$1");
  const out = [];
  const sep = /&&|\|\||[;|&]/g;
  let start = 0;
  for (let m; (m = sep.exec(code));) {
    out.push({ start, text: code.slice(start, m.index) });
    start = m.index + m[0].length;
  }
  out.push({ start, text: code.slice(start) });
  return out;
}

/**
 * uv's subcommands. The subcommand is the first of these after `uv`;
 * everything before it is a global option or its value. A list of the
 * global options that take a value is the other way to skip them, and it
 * was wrong when written from memory (`--python` is not global,
 * `--allow-insecure-host` is; python-uv-widened, plan review).
 */
export const UV_SUBCOMMANDS = new Set([
  "add",
  "audit",
  "auth",
  "build",
  "cache",
  "check",
  "export",
  "format",
  "generate-shell-completion",
  "help",
  "init",
  "lock",
  "pip",
  "publish",
  "python",
  "remove",
  "run",
  "self",
  "sync",
  "tool",
  "tree",
  "venv",
  "version",
  "workspace",
]);

/** `uv run` options that take a value, so their value is not the command. */
const RUN_VALUE_OPTIONS = new Set([
  "--only-group",
  "--group",
  "--no-group",
  "--extra",
  "--no-extra",
  "--with",
  "--with-requirements",
  "--with-editable",
  "-w",
  "--project",
  "--directory",
  "--env-file",
  "--python",
  "-p",
  "--index",
  "--default-index",
  "--index-url",
  "--extra-index-url",
  "--package",
  "--script",
  "--module",
  "-m",
]);

/** A word that is the uv executable, however it is spelled in a command:
 *  `uv`, `(uv`, `$(uv`, `"uv` at the start of a JS string, `/usr/bin/uv`. */
const isUvWord = (w) => w.replace(/^.*[(`"'$/{]/, "") === "uv";

/** An environment assignment's value that turns a uv setting on. */
const truthy = (v) => !["", "0", "false", "no", "off"].includes(v.toLowerCase());

/**
 * A uv call in one command segment. Null when the segment calls no uv.
 * Quotes must already be blanked in shell text.
 *
 * - `env`: the names assigned a truthy value before uv;
 * - `subcommand`: the first of uv's subcommands after it;
 * - `words`: every word after uv up to `--`, global positions included,
 *   which is where banned flags are looked for. Reading more than uv
 *   receives can only add a finding, never hide one;
 * - `options`: for `run`, the words before the command it launches, where
 *   `--frozen` must stand (`uv run python x.py --frozen` hands it to
 *   x.py). Where that command starts depends on which options take a
 *   value, a hand-kept list (RUN_VALUE_OPTIONS); a missing entry ends the
 *   options early, which can only report a missing `--frozen` that is
 *   there, loudly, never pass one that is not.
 */
export function parseUv(segment) {
  const all = segment.trim().split(/\s+/).filter(Boolean);
  const at = all.findIndex(isUvWord);
  if (at < 0) return null;
  const env = new Set(
    all.slice(0, at)
      .filter((w) => /^[A-Za-z_]\w*=/.test(w) && truthy(w.slice(w.indexOf("=") + 1)))
      .map((w) => w.split("=")[0]),
  );
  // Between uv and its subcommand only global options may stand, and a
  // bare word only as the value of the option just before it. Any other
  // word means prose that mentions uv ("Install uv to run them"), not a call.
  let i = at + 1;
  while (i < all.length && !UV_SUBCOMMANDS.has(all[i])) {
    const prev = all[i - 1];
    const isValue = i > at + 1 && prev.startsWith("-") && !prev.includes("=");
    if (!all[i].startsWith("-") && !isValue) return null;
    i++;
  }
  const subcommand = all[i] ?? null;
  const next = all[i + 1] ?? null;
  const end = all.indexOf("--", at + 1);
  const words = all.slice(at + 1, end < 0 ? all.length : end);
  const options = [];
  for (i++; i < all.length; i++) {
    const w = all[i];
    if (w === "--") break;
    if (!w.startsWith("-")) {
      if (subcommand === "run") break;
      options.push(w);
      continue;
    }
    options.push(w);
    if (!w.includes("=") && RUN_VALUE_OPTIONS.has(w) && i + 1 < all.length) {
      options.push(all[++i]);
    }
  }
  return {
    env,
    subcommand,
    next,
    words,
    options,
  };
}

/** True when a command segment runs or syncs through uv. */
export const isUvRunOrSync = (segment) =>
  ["run", "sync"].includes(parseUv(segment)?.subcommand ?? "");

/** The banned flag an option is, or undefined. */
export function bannedFlag(option) {
  const name = option.split("=")[0];
  return BANNED_UV_FLAGS.find(([flag]) =>
    flag === "-w"
      ? /^-w(?!-)/.test(name) && !name.startsWith("--")
      : name === flag || name.startsWith(flag + "-")
  );
}

/**
 * What is wrong with the uv invocations on one line, as short phrases.
 * Each command is judged on its own flags: searched over the whole line,
 * `uv run python -V && echo --frozen` passed because an unrelated word
 * carried the flag (PR #575 review).
 */
export function uvFindings(cmd) {
  const out = [];
  for (const { text } of commandSegments(cmd)) {
    const uv = parseUv(text);
    if (/\buvx\b/.test(text) || (uv?.subcommand === "tool" && uv.next === "run")) {
      out.push("`uvx`/`uv tool run` (resolves outside uv.lock)");
    }
    if (uv?.subcommand === "pip") {
      out.push("`uv pip`");
      continue;
    }
    if (uv === null || !["run", "sync"].includes(uv.subcommand)) continue;
    for (const word of uv.words) {
      const banned = bannedFlag(word);
      if (banned) out.push(`\`${word.split("=")[0]}\` (${banned[1]})`);
    }
    // The environment spellings: UV_NO_PROJECT and UV_ISOLATED are the
    // banned flags by another name; UV_FROZEN and UV_LOCKED assert the lock.
    for (const name of ["UV_NO_PROJECT", "UV_ISOLATED"]) {
      if (uv.env.has(name)) out.push(`\`${name}\` (resolves outside uv.lock)`);
    }
    const asserted = uv.options.some((o) => o === "--frozen" || o === "--locked")
      || uv.env.has("UV_FROZEN") || uv.env.has("UV_LOCKED");
    if (!asserted) {
      out.push("`uv run`/`uv sync` with neither --frozen nor --locked");
    }
  }
  return out;
}

/**
 * The command with every heredoc body emptied. A body is data on a
 * command's stdin, not shell: a node script's regex `(?:run|sync|p1p)`
 * with the last word spelled right was refused as a bare interpreter,
 * and an apostrophe in a body paired with a quote lines later and
 * blanked real commands. The interpreter that reads the body sits on the
 * `<<` line itself, so `python3 - <<EOF` is still refused there.
 */
export function withoutHeredocBodies(command) {
  const lines = command.split("\n");
  let end = null;
  return lines.map((line) => {
    if (end !== null) {
      if (end.test(line)) end = null;
      return "";
    }
    const m = /<<(-?)\s*(['"]?)([A-Za-z_]\w*)\2/.exec(line);
    if (m) end = new RegExp(`^${m[1] ? "\\t*" : ""}${m[3]}\\s*$`);
    return line;
  }).join("\n");
}

/**
 * Every finding in a shell command, with the line it is on. Quotes are
 * blanked over the whole command before it is split into lines: a
 * multi-line `git commit -m "..."` is one string, and blanking line by
 * line read its prose as commands (the hook refused its own commit).
 */
export function shellCommandFindings(command) {
  const out = [];
  const raws = command.split("\n");
  for (const { line, text: cmd } of logicalLines(blankQuoted(withoutHeredocBodies(command)))) {
    const text = raws[line - 1];
    const bare = bareInterpreter(cmd);
    if (bare) out.push({ line, what: `bare \`${bare}\``, raw: text });
    for (const what of uvFindings(cmd)) out.push({ line, what, raw: text });
  }
  return out;
}
