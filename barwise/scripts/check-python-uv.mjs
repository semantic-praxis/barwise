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
 * There is no exemption for any bare interpreter, the bootstrap included:
 * uv itself comes from scripts/install-uv.sh's verified release tarball
 * (python-uv-widened WS4), so nothing runs Python before uv exists, and a
 * `python3 -m pip install uv` line fails here like any other bare
 * python3. Which uv runs is check:pins' question, not this one.
 *
 * What it deliberately does NOT read, so the next reader does not have to
 * infer the boundary from the code:
 *
 *   .md                           prose. A banned form there instructs a
 *                                 human rather than running, which is a
 *                                 real failure -- two such instructions
 *                                 were fixed alongside this gate -- but
 *                                 not one this matcher can separate from
 *                                 a mention. package.json scripts,
 *                                 Makefile recipes and the git hooks ARE
 *                                 read (python-uv-widened WS2): they run.
 *   .beads/hooks/                 vendored by the tracker, and named as
 *                                 unread in the gate's OK line.
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
import { basename, extname, resolve } from "node:path";
import {
  bannedFlag,
  bareInterpreter,
  blankQuoted,
  INTERPRETER,
  logicalLines,
  shellCommandFindings,
  UV_SUBCOMMANDS,
  uvFindings,
} from "./lib/python-uv-rules.mjs";
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
 * install-uv.test.mjs is here for the same reason: it plants a uvx in a
 * stand-in release and a stale BIN_DIR, to prove the installer removes
 * it, and runs no Python.
 */
const SELF = new Set([
  "barwise/scripts/check-python-uv.mjs",
  "barwise/scripts/lib/python-uv-rules.mjs",
  "barwise/scripts/hooks/python-uv-guard.mjs",
  "barwise/scripts/tests/gates.test.mjs",
  "barwise/scripts/tests/install-uv.test.mjs",
  "barwise/scripts/tests/python-uv-guard.test.mjs",
]);

/** `subprocess.run(["python3", ...])` and `os.system("python3 ...")`. A .py
 *  file spawning a bare interpreter escapes the lock exactly as a shell one
 *  does; scanning .py only for PEP 723 left that whole half unread. */
const PY_SUBPROCESS = new RegExp(
  String
    .raw`(?:subprocess\.\w+|os\.system|os\.exec\w*|os\.spawn\w*)\s*\(\s*\[?\s*["'](${INTERPRETER})`,
);

/**
 * `subprocess.run(["uv", ...])`: a uv call whose words are list literals.
 * One line only, like every rule here: a list written one element per line
 * is not read. `os.exec*` and `os.spawn*` take the program before the list,
 * so they are not this shape.
 */
const PY_UV_LIST = /subprocess\.\w+\s*\(\s*\[\s*((?:["']uv["'])[^\]]*)\]/;

/** `execFileSync("python3", ...)` and friends. A quoted name alone is not enough:
 *  `".py": "python"` in a language table is a label, not an invocation. */
const CHILD_PROCESS = new RegExp(
  String
    .raw`\b(?:execFileSync|execFile|spawnSync|spawn|execSync|exec)\s*\(\s*["'\`](${INTERPRETER})`,
);

/** Strip a comment line, so this file's own prose is not a violation. */
function isComment(line, ext) {
  const t = line.trimStart();
  if (SHELLISH.has(ext) || ext === ".py") return t.startsWith("#");
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

/**
 * Strip the YAML that precedes a command, so a single-line step is read as
 * one. `- run: python3 -m tool` has no shell separator before `python3`, so
 * bareInterpreter could not see it -- and the single-line form is how nearly
 * every step in this repo's own ci.yml is written, including this gate's.
 * The block form (`run: |` then the command on its own line) always worked,
 * and was the only form the tests planted.
 */
function stripYamlPrefix(line) {
  return line.replace(/^(\s*)-\s+/, "$1").replace(/^\s*[\w.-]+:\s+/, "");
}

/**
 * `execFileSync("uv", [...UV_PYTHON, "-c", src])` -- the form every
 * converted call site uses (six across two bridges once; three since dbt's
 * copy was deleted in format-renderers-to-connectors WS3). Its flags live in a spread const several lines
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
  // A literal that IS a banned option, in any spelling: "--with=sqlglot"
  // and "--with-editable" were whole literals the old set lookup missed.
  for (const lit of lits) {
    const banned = bannedFlag(lit);
    if (banned) out.push({ file, line, what: `\`${lit.split("=")[0]}\` (${banned[1]})`, raw });
  }
  // The one exemption is read-only interpreter discovery: `uv python find`
  // resolves no packages (check-pins.mjs, runtime-pins-check.spec.md).
  // Named by what is safe, not by what resolves, so `lock`, `export`,
  // `tree` and any subcommand added later still need the flag; and per
  // file, so a file that also names any of them is not spared.
  const READ_ONLY = new Set(["python", "find", "--show-version", "--project"]);
  const subcommands = [...lits].filter((l) => UV_SUBCOMMANDS.has(l));
  const resolves =
    !(lits.has("python") && lits.has("find") && subcommands.every((l) => READ_ONLY.has(l)));
  if (resolves && !lits.has("--frozen") && !lits.has("--locked")) {
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

/**
 * What kind of command-bearing file this is, beyond the extension rules
 * (python-uv-widened WS2): "package" for a package.json, whose scripts
 * values are commands; "make" for a makefile, whose recipe lines are; and
 * ".sh" for the extensionless git hooks under barwise/.husky/, which are
 * shell and go through the main loop like any .sh file. Null otherwise.
 * One classifier, so which files are read is decided in one place.
 */
function fileKind(file) {
  const name = basename(file);
  if (name === "package.json") return "package";
  if (/^(GNUmakefile|makefile|Makefile)$|\.mk$/.test(name)) return "make";
  if (/^barwise\/\.husky\/(?!_\/)[^./]+$/.test(file)) return ".sh";
  return null;
}

/**
 * The commands in a package.json's scripts or a makefile's recipes, as
 * `{ line, text }`. A package.json that does not parse throws: the gate
 * cannot see its scripts, which is a refusal, never a clean read.
 */
function commandLines(kind, text) {
  if (kind === "package") {
    const scripts = JSON.parse(text).scripts ?? {};
    const lines = text.split("\n");
    // Each name is looked up inside the scripts object, so a same-named key
    // elsewhere (vscode's contributes) does not take its line.
    const from = lines.findIndex((l) => l.includes('"scripts":'));
    return Object.entries(scripts).map(([name, cmd]) => ({
      line: lines.findIndex((l, i) => i > from && l.includes(JSON.stringify(name) + ":")) + 1,
      text: String(cmd),
    }));
  }
  // make's recipe prefixes (@ silent, - ignore errors, + always run) come
  // before the command; left on, `@python3` was not read as python3.
  return logicalLines(text)
    .filter(({ text: l }) => l.startsWith("\t"))
    .map(({ line, text: l }) => ({ line, text: l.replace(/^\t[@+-]*/, "") }));
}

const unreadable = [];

// Listed once: the main loop and the project check read the same tree.
const tracked = trackedFiles();
for (const file of tracked) {
  if (SELF.has(file)) continue;
  if (file.startsWith(".beads/hooks/")) continue;
  const kind = fileKind(file);
  const ext = kind === ".sh" ? ".sh" : extname(file);
  const special = kind === "package" || kind === "make";
  if (!special && !SHELLISH.has(ext) && !JSISH.has(ext) && ext !== ".py") continue;

  let text;
  try {
    text = readFileSync(resolve(REPO_ROOT, file), "utf8");
  } catch {
    continue; // deleted in the working tree; not this gate's business
  }

  if (special) {
    let commands;
    try {
      commands = commandLines(kind, text);
    } catch (err) {
      unreadable.push(`${file}: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    for (const { line, text: command } of commands) {
      for (const f of shellCommandFindings(command)) {
        findings.push({ file, line: line + f.line - 1, what: f.what, raw: command });
      }
    }
    continue;
  }

  if (JSISH.has(ext)) findings.push(...uvArgsArray(file, text));

  for (const { line, text: raw } of logicalLines(text)) {
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
      const bare = bareInterpreter(ext === ".sh" ? cmd : stripYamlPrefix(cmd));
      if (bare) findings.push({ file, line, what: `bare \`${bare}\``, raw });
    }
    if (JSISH.has(ext)) {
      const m = CHILD_PROCESS.exec(raw);
      if (m) findings.push({ file, line, what: `bare \`${m[1]}\` subprocess`, raw });
    }
    if (ext === ".py") {
      const m = PY_SUBPROCESS.exec(raw);
      if (m) findings.push({ file, line, what: `bare \`${m[1]}\` subprocess`, raw });
      // A uv call as a subprocess list: its words are the list's string
      // literals, read as one command.
      const list = PY_UV_LIST.exec(raw);
      if (list) {
        const words = [...list[1].matchAll(/["']([^"']*)["']/g)].map((w) => w[1]);
        for (const what of uvFindings(words.join(" "))) findings.push({ file, line, what, raw });
      }
    }

    for (const what of uvFindings(cmd)) findings.push({ file, line, what, raw });
  }
}

/**
 * One project, and nothing else that changes what resolves
 * (python-from-the-lockfile decisions 3 and 4; python-uv-widened WS3).
 * uv finds the project by walking up from the working directory, so a
 * second pyproject.toml would be the project for everything below it,
 * with its own lock; and requirements files, setup.py, uv.toml or a
 * pylock.toml change what resolves without uv.lock saying so.
 */
const PROJECT_FILES = new Set(["barwise/pyproject.toml", "barwise/uv.lock"]);
const MANIFEST =
  /(^|\/)(pyproject\.toml|requirements[^/]*\.txt|setup\.py|setup\.cfg|Pipfile(\.lock)?|uv\.toml|pylock[^/]*\.toml|uv\.lock)$/;
for (const file of tracked) {
  if (MANIFEST.test(file) && !PROJECT_FILES.has(file)) {
    findings.push({
      file,
      line: 1,
      what: "a Python manifest outside barwise/pyproject.toml and barwise/uv.lock",
      raw:
        "the project is barwise/pyproject.toml, locked by barwise/uv.lock; add a dependency group there",
    });
  }
}
for (const file of PROJECT_FILES) {
  if (!tracked.includes(file)) {
    findings.push({
      file,
      line: 0,
      what: "the project file is not tracked",
      raw: "every Python run resolves from barwise/pyproject.toml and barwise/uv.lock",
    });
  }
}

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
  for (const u of unreadable) console.error(`\ncould not read ${u}`);
  process.exit(1);
}
// A finding outranks a refusal; with none, a file the gate could not read
// is "could not answer", never a clean pass (gate-refusal-contract).
if (unreadable.length > 0) {
  console.error("check-python-uv: cannot answer --");
  for (const u of unreadable) console.error(`  could not read ${u}`);
  process.exit(2);
}

console.log(
  "check-python-uv: no bare interpreters, no lock bypasses; "
    + ".beads/hooks/ not read, vendored. OK",
);
