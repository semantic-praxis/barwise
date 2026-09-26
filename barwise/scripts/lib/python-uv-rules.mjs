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
 * is a bare interpreter as surely as `python3` is. `timeout` takes a
 * duration first.
 */
const WRAPPER = String.raw`(?:(?:env|exec|time|nohup|nice|timeout\s+\S+)\s+)*`;

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

/** What is wrong with the uv invocations on one line, as short phrases. */
export function uvFindings(cmd) {
  const out = [];
  if (UV_TOOL.test(cmd)) out.push("`uvx`/`uv tool run` (resolves outside uv.lock)");
  if (/\buv\s+(?:run|sync|pip)\b/.test(cmd)) {
    if (/\buv\s+pip\b/.test(cmd)) {
      out.push("`uv pip`");
    } else {
      for (const [flag, why] of BANNED_UV_FLAGS) {
        if (cmd.includes(flag)) out.push(`\`${flag}\` (${why})`);
      }
      if (!/--frozen|--locked/.test(cmd)) {
        out.push("`uv run`/`uv sync` with neither --frozen nor --locked");
      }
    }
  }
  return out;
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
  for (const { line, text: cmd } of logicalLines(blankQuoted(command))) {
    const text = raws[line - 1];
    const bare = bareInterpreter(cmd);
    if (bare) out.push({ line, what: `bare \`${bare}\``, raw: text });
    for (const what of uvFindings(cmd)) out.push({ line, what, raw: text });
  }
  return out;
}
