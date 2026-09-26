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

export const BANNED_UV_FLAGS = [
  ["--with-requirements", "reads requirements outside the lockfile"],
  ["--with", "resolves against the index, not uv.lock -- a lock bypass"],
  ["--isolated", "resolves outside the project entirely"],
  ["--no-project", "runs with no project, so no lock -- --isolated by another name"],
];

/** `uvx` and `uv tool run` resolve a tool from the index, never uv.lock. */
const UV_TOOL = /\buvx\b|\buv\s+tool\s+run\b/;

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

/** A command that runs or syncs through uv, so needs the lockfile. */
export const UV_RUN = /\buv\s+(?:run|sync)\b/;

/**
 * What is wrong with the uv invocations on one line, as short phrases.
 * Each command is judged on its own flags: searched over the whole line,
 * `uv run python -V && echo --frozen` passed because an unrelated word
 * carried the flag (PR #575 review).
 */
export function uvFindings(cmd) {
  const out = [];
  for (const { text } of commandSegments(cmd)) {
    if (UV_TOOL.test(text)) out.push("`uvx`/`uv tool run` (resolves outside uv.lock)");
    if (/\buv\s+pip\b/.test(text)) {
      out.push("`uv pip`");
      continue;
    }
    if (!UV_RUN.test(text)) continue;
    for (const [flag, why] of BANNED_UV_FLAGS) {
      if (text.includes(flag)) out.push(`\`${flag}\` (${why})`);
    }
    if (!/--frozen|--locked/.test(text)) {
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
