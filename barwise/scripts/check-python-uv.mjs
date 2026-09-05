#!/usr/bin/env node
/**
 * Every Python execution resolves from the project lockfile.
 *
 * The rule (repo CLAUDE.md) is `uv run --frozen [--only-group <g>] ...`,
 * `--locked` in CI, and never a bare interpreter. This gate exists
 * because that rule is only worth what checks it: the `.python-version`
 * pin shipped while six bare `python3` calls stood in tracked source,
 * and nothing noticed for the life of the pin.
 *
 * What each banned form actually costs:
 *
 *   bare python3/python/pip  the ambient interpreter with ambient
 *                            site-packages -- escapes both the pinned
 *                            minor and the locked dependency set.
 *   --with, --with-requirements
 *                            a LOCK BYPASS. Against a lock pinning
 *                            sqlglot==27.28.0, `uv run --with
 *                            sqlglot==27.20.0` runs 27.20.0, and so do
 *                            the --frozen and --locked spellings of it,
 *                            while `uv lock --check` still reports
 *                            clean. The assertion flags do not close it,
 *                            which is why it is banned rather than
 *                            paired with something.
 *   --isolated, uv pip       resolve outside the project entirely.
 *   uv run/sync with neither --frozen nor --locked
 *                            re-locks silently, so a stale lock is
 *                            repaired instead of reported.
 *   PEP 723 inline metadata  pins versions in the script, where the
 *                            lockfile does not govern them.
 *
 * The gate reads text, not behaviour, and that is the point: every
 * required and banned form above is literal text in a command, which is
 * what makes this checkable where "activate the venv first" is not.
 *
 * What it deliberately does NOT read, so the next reader does not have to
 * infer the boundary from the code:
 *
 *   .md, Makefile, package.json   prose and script strings. A banned form
 *                                 there instructs a human rather than
 *                                 running, which is a real failure -- two
 *                                 such instructions were fixed alongside
 *                                 this gate -- but not one this matcher
 *                                 can separate from a mention.
 *   a command inside a string     `bash -c "python3 ..."`, or an
 *                                 interpreter held in a variable. Quoted
 *                                 text is blanked before matching (see
 *                                 blankQuoted); the alternative is a gate
 *                                 that cries wolf on its own error text.
 *   uv's own resolution           whether uv.lock is current. That is
 *                                 `uv lock --check`, and it is a different
 *                                 question from how uv was invoked.
 */
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { REPO_ROOT, trackedFiles } from "./lib/tracked.mjs";

/** Files whose contents are commands. */
const SHELLISH = new Set([".sh", ".yml", ".yaml"]);
/** Files where an interpreter is reached through child_process. */
const JSISH = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);

/**
 * This gate and its test carry every banned form as DATA -- patterns to
 * match and defects to plant. Scanning them would report the gate as its
 * own violation. Both are exempt by path rather than by some cleverness
 * that distinguishes a pattern from an invocation, because that
 * cleverness is exactly the kind of thing that fails silently.
 */
const SELF = new Set([
  "barwise/scripts/check-python-uv.mjs",
  "barwise/scripts/tests/gates.test.mjs",
]);

/**
 * The one execution that cannot go through uv, with its reason inline.
 *
 * Ratcheted in both directions, like `audit:duplication` and
 * `audit:rubric`: an entry whose `match` is no longer present fails, so
 * removing a violation forces its row out and the allowlist always
 * enumerates exactly what is exempt.
 */
const ALLOWLIST = [
  {
    file: ".github/workflows/ci.yml",
    match: "python3 -m pip install --quiet uv==",
    why: "bootstrapping uv itself -- the one execution that cannot go through uv",
  },
];

/** Interpreter names, refusing `python-version` and `.python-version`. */
const INTERPRETER = String.raw`(?:python3|python|pip3|pip)(?![\w.-])`;

/** A command position in a shell line: start, or after a separator. */
const COMMAND_POS = new RegExp(
  String.raw`(?:^|[;&|(]|&&|\|\||\$\()\s*(?:[A-Za-z_]\w*=\S*\s+)*(${INTERPRETER})`,
);

/** `subprocess.run(["python3", ...])` and `os.system("python3 ...")`. A .py
 *  file spawning a bare interpreter escapes the lock exactly as a shell one
 *  does; scanning .py only for PEP 723 left that whole half unread. */
const PY_SUBPROCESS = new RegExp(
  String
    .raw`(?:subprocess\.\w+|os\.system|os\.exec\w*|os\.spawn\w*)\s*\(\s*\[?\s*["'](${INTERPRETER})`,
);

/** `execFileSync("python3", ...)` and friends. A quoted name alone is not enough:
 *  `".py": "python"` in a language table is a label, not an invocation. */
const CHILD_PROCESS = new RegExp(
  String
    .raw`\b(?:execFileSync|execFile|spawnSync|spawn|execSync|exec)\s*\(\s*["'\`](${INTERPRETER})`,
);

const BANNED_UV_FLAGS = [
  ["--with-requirements", "reads requirements outside the lockfile"],
  ["--with", "resolves against the index, not uv.lock -- a lock bypass"],
  ["--isolated", "resolves outside the project entirely"],
  ["--no-project", "runs with no project, so no lock -- --isolated by another name"],
];

/** `uvx` and `uv tool run` resolve a tool from the index, never from
 *  uv.lock. Banned for the same reason as `uv pip`, and the obvious way
 *  round it once `uv pip` is closed. */
const UV_TOOL = /\buvx\b|\buv\s+tool\s+run\b/;

/**
 * Blank the contents of quoted strings before matching a COMMAND, so an
 * `echo "== uv sync"` heading is not read as an invocation. The trade is
 * explicit: a genuine `bash -c "python3 ..."` would be missed. None exists
 * here, and the alternative -- flagging every mention -- makes the gate
 * cry wolf on its own error messages, which is how a gate gets disabled.
 */
function blankQuoted(line) {
  return line.replace(/"[^"]*"|'[^']*'/g, (m) => m[0].repeat(m.length));
}

/** Strip a comment line, so this file's own prose is not a violation. */
function isComment(line, ext) {
  const t = line.trimStart();
  if (SHELLISH.has(ext) || ext === ".py") return t.startsWith("#");
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

/**
 * Strip the YAML that precedes a command, so a single-line step is read as
 * one. `- run: python3 -m tool` has no shell separator before `python3`, so
 * COMMAND_POS could not see it -- and the single-line form is how nearly
 * every step in this repo's own ci.yml is written, including this gate's.
 * The block form (`run: |` then the command on its own line) always worked,
 * and was the only form the tests planted.
 */
function stripYamlPrefix(line) {
  return line.replace(/^(\s*)-\s+/, "$1").replace(/^\s*[\w.-]+:\s+/, "");
}

/** Join `\`-continued shell lines, so a flag on line 2 counts as line 1's. */
function logicalLines(text) {
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

/**
 * `execFileSync("uv", [...UV_PYTHON, "-c", src])` -- the form all six
 * converted call sites use. Its flags live in a spread const several lines
 * away, so no line carries the whole invocation and the line rules below
 * cannot see it. Checked over the file instead: a file that spawns uv must
 * carry an assertion flag and no bypass, as a string literal somewhere.
 *
 * This was not academic. Deleting "--frozen" from both SqlglotBridge copies
 * passed check:parity (they stayed identical) and passed this gate.
 */
const CHILD_PROCESS_UV = /\b(?:execFileSync|execFile|spawnSync|spawn)\s*\(\s*["'\`]uv["'\`]/;
const STRING_LITERAL = /["'\`]([^"'\`\n]*)["'\`]/g;

/** Findings for a JS/TS file that spawns uv, or [] if it does not. */
function uvArgsArray(file, text) {
  const m = CHILD_PROCESS_UV.exec(text);
  if (!m) return [];
  const line = text.slice(0, m.index).split("\n").length;
  const raw = m[0];
  const lits = new Set([...text.matchAll(STRING_LITERAL)].map((s) => s[1]));
  const out = [];
  if (lits.has("pip")) {
    out.push({ file, line, what: "`uv pip` (args array)", raw });
    return out;
  }
  for (const [flag, why] of BANNED_UV_FLAGS) {
    if (lits.has(flag)) out.push({ file, line, what: `\`${flag}\` (${why})`, raw });
  }
  if (!lits.has("--frozen") && !lits.has("--locked")) {
    out.push({
      file,
      line,
      what: "`uv` spawned with neither --frozen nor --locked",
      raw,
    });
  }
  return out;
}

const findings = [];
const allowHits = new Set();

for (const file of trackedFiles()) {
  const ext = extname(file);
  if (!SHELLISH.has(ext) && !JSISH.has(ext) && ext !== ".py") continue;
  if (SELF.has(file)) continue;
  if (file.startsWith(".beads/hooks/")) continue;

  let text;
  try {
    text = readFileSync(resolve(REPO_ROOT, file), "utf8");
  } catch {
    continue; // deleted in the working tree; not this gate's business
  }

  if (JSISH.has(ext)) findings.push(...uvArgsArray(file, text));

  for (const { line, text: raw } of logicalLines(text)) {
    const allowed = ALLOWLIST.find((a) => a.file === file && raw.includes(a.match));
    if (allowed) {
      allowHits.add(allowed.match);
      continue;
    }
    // Tested BEFORE the comment skip: a PEP 723 block IS a comment block,
    // so skipping comments first made this rule unreachable. The per-form
    // test caught it; an aggregate one would have stayed green.
    if (ext === ".py" && /^#\s*\/\/\/\s*script/.test(raw)) {
      findings.push({ file, line, what: "PEP 723 inline script metadata", raw });
      continue;
    }
    if (isComment(raw, ext)) continue;

    const cmd = SHELLISH.has(ext) || ext === ".py" ? blankQuoted(raw) : raw;

    if (SHELLISH.has(ext)) {
      const m = COMMAND_POS.exec(ext === ".sh" ? cmd : stripYamlPrefix(cmd));
      if (m) findings.push({ file, line, what: `bare \`${m[1]}\``, raw });
    }
    if (JSISH.has(ext)) {
      const m = CHILD_PROCESS.exec(raw);
      if (m) findings.push({ file, line, what: `bare \`${m[1]}\` subprocess`, raw });
    }
    if (ext === ".py") {
      const m = PY_SUBPROCESS.exec(raw);
      if (m) findings.push({ file, line, what: `bare \`${m[1]}\` subprocess`, raw });
    }

    if (UV_TOOL.test(cmd)) {
      findings.push({ file, line, what: "`uvx`/`uv tool run` (resolves outside uv.lock)", raw });
    }

    if (/\buv\s+(?:run|sync|pip)\b/.test(cmd)) {
      if (/\buv\s+pip\b/.test(cmd)) {
        findings.push({ file, line, what: "`uv pip`", raw });
      } else {
        for (const [flag, why] of BANNED_UV_FLAGS) {
          if (cmd.includes(flag)) findings.push({ file, line, what: `\`${flag}\` (${why})`, raw });
        }
        if (!/--frozen|--locked/.test(cmd)) {
          findings.push({
            file,
            line,
            what: "`uv run`/`uv sync` with neither --frozen nor --locked",
            raw,
          });
        }
      }
    }
  }
}

// A stale exemption is a failure in its own right: it means a violation
// was fixed and its licence outlived it. Without this, an allowlist only
// ever grows, and stops describing the code.
const stale = ALLOWLIST.filter((a) => !allowHits.has(a.match));

if (findings.length > 0 || stale.length > 0) {
  if (findings.length > 0) {
    console.error("Python must resolve from the project lockfile:\n");
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line}  ${f.what}`);
      console.error(`      ${f.raw.trim().slice(0, 110)}`);
    }
    console.error(
      "\nUse `uv run --frozen --only-group <group> python ...` (or --locked in\n"
        + "CI). Never a bare interpreter, and never --with/--isolated/uv pip:\n"
        + "those resolve outside uv.lock, and --frozen does not close them.",
    );
  }
  for (const s of stale) {
    console.error(
      `\nSTALE allowlist entry: ${s.file} no longer contains\n  ${s.match}\n`
        + "Remove it from ALLOWLIST -- an exemption that outlives its violation\n"
        + "stops describing the code.",
    );
  }
  process.exit(1);
}

console.log(
  `check-python-uv: no bare interpreters, no lock bypasses; `
    + `${ALLOWLIST.length} allowlisted (uv bootstrap). OK`,
);
