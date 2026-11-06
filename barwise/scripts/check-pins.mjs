#!/usr/bin/env node
/**
 * check:pins -- each runtime has one declared pin that the tools read, and
 * the runtime that ran is the pinned one
 * (docs/specs/runtime-pins-check.spec.md; the rules are
 * docs/adr/pinned-runtimes.md; this is deterministic-guards.spec.md's
 * workstream 4).
 *
 * A pin is worth what reads it. `.python-version` shipped at the root,
 * where `uv python install` reads it and `uv run` does not, so outside CI
 * the interpreter floated within `requires-python` (barwise-g32). So this
 * holds where the pins live and what reads them, and then reads back what
 * actually runs: decision 3, "verify the interpreter that ran, never the
 * file that asked".
 *
 * Copies of a pin are not checked here. deterministic-guards rejected a
 * second must-agree mechanism; the two `.python-version` files are a set
 * in parity.manifest.json, and README.md names `.nvmrc` rather than
 * restating its number.
 *
 * Findings, exit 1:
 *   - a workflow's actions/setup-node step without `node-version-file:
 *     .nvmrc`, or with `node-version`;
 *   - the session hook not reading .nvmrc;
 *   - a `.python-version` missing at the root or beside pyproject.toml, or
 *     naming more than a minor (decision 2: uv did not enforce a patch).
 * Refusals, exit 2 (docs/adr/gate-refusal-contract.md):
 *   - the Node running this on another major than .nvmrc;
 *   - the Python `uv python find` resolves for the project on another
 *     minor than the pin, or uv absent or failing. `find` reads and
 *     writes nothing, where `uv run` would sync the project and could
 *     rebuild a venv; and it answers for a venv already on another minor,
 *     which the file alone cannot show.
 *   - the uv that runs (`uv --version`) on another version than
 *     scripts/install-uv.sh's VERSION, or that script or its VERSION line
 *     missing (python-from-the-lockfile decision 5, python-uv-widened WS4).
 *     uv is installed only by that script; this reads back what runs,
 *     however it was installed, since a cached older uv first on PATH is
 *     what a session kept before the installer ran on every start.
 *   - a pin file or workflow that would not read.
 * A finding outranks a refusal. The exact versions print on every run, so
 * a reading is attributable; a Node patch that differs is printed, not
 * refused (the spec's open decision 2).
 *
 * Usage: node scripts/check-pins.mjs [--root <repo>]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";

const MINOR = /^(\d+)\.(\d+)$/;

/** Findings about the workflows' Node setup, from their parsed YAML. */
export function workflowFindings(workflows) {
  const out = [];
  for (const [file, doc] of workflows) {
    for (const [name, job] of Object.entries(doc?.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        if (!/^actions\/setup-node@/.test(step?.uses ?? "")) continue;
        const w = step.with ?? {};
        if (w["node-version"] !== undefined) {
          out.push(
            `${file}: job ${name} sets node-version; Node comes from node-version-file: .nvmrc`,
          );
        }
        if (w["node-version-file"] !== ".nvmrc") {
          out.push(`${file}: job ${name}'s setup-node does not read node-version-file: .nvmrc`);
        }
      }
    }
  }
  return out;
}

/** What is wrong with a .python-version's text, or null. */
export function pythonPinProblem(text) {
  const v = text.trim();
  return MINOR.test(v) ? null : `names "${v}", not a minor such as 3.13`;
}

/** A Node version's [major, minor, patch], with or without a leading v. */
export const nodeParts = (v) => v.trim().replace(/^v/, "").split(".");

/**
 * A refusal when the running versions are not the pinned ones, or null.
 * Node is held to its major and minor: CLAUDE.md says coverage thresholds
 * are not portable across Node versions, and a minor can change V8. Only a
 * patch that differs is printed rather than refused (the spec's open
 * decision 2). `pin` is the file uv read, beside pyproject.toml.
 */
export function runningProblem({ nvmrc, node, pin, python }) {
  const [wantMajor, wantMinor] = nodeParts(nvmrc);
  const [haveMajor, haveMinor] = nodeParts(node);
  if (wantMajor !== haveMajor || wantMinor !== haveMinor) {
    return `Node ${node} is running, another major or minor than .nvmrc's ${nvmrc.trim()}`;
  }
  if (pin === undefined) return null;
  const [, major, minor] = MINOR.exec(pin.trim()) ?? [];
  const m = /^(\d+)\.(\d+)/.exec(python ?? "");
  if (!m) return `uv resolved no Python version for the project (read "${python}")`;
  if (m[1] !== major || m[2] !== minor) {
    return `uv resolves Python ${python} for the project, another minor than barwise/.python-version's ${pin.trim()}`;
  }
  return null;
}

/**
 * True when a session hook reads .nvmrc: a line that names it outside a
 * comment and is not a message an echo or printf prints. A trailing
 * comment or an echoed mention is not a read.
 */
export function hookReadsNvmrc(text) {
  return text.split("\n").some((line) => {
    const code = line.replace(/(^|\s)#.*$/, "$1");
    return /\.nvmrc/.test(code) && !/^\s*(echo|printf)\b/.test(code);
  });
}

const UV_VERSION_LINE = /^VERSION="([^"]+)"$/m;

/** The uv version scripts/install-uv.sh installs, read from its text. */
export function installerVersion(text) {
  const m = UV_VERSION_LINE.exec(text);
  if (!m) throw new Error('scripts/install-uv.sh has no VERSION="..." line');
  return m[1];
}

/**
 * A refusal when the uv that runs is not the installer's pin, or null.
 * `reported` is `uv --version`'s output, e.g. "uv 0.12.7 (abc123 2026-10-30)".
 */
export function uvVersionProblem({ pinned, reported }) {
  const m = /^uv (\S+)/.exec(reported.trim());
  if (m && m[1] === pinned) return null;
  return `uv ${
    m ? m[1] : `"${reported.trim()}"`
  } is running, not scripts/install-uv.sh's ${pinned}; `
    + "run `bash barwise/scripts/install-uv.sh ~/.local/bin` and put ~/.local/bin first on PATH";
}

/** `uv --version`, from the uv on PATH: the one every other uv call runs. */
function uvVersion() {
  const r = spawnSync("uv", ["--version"], { encoding: "utf8" });
  if (r.error) {
    throw new Error(
      `uv could not be run (${
        r.error.code ?? r.error.message
      }); install it with scripts/install-uv.sh, the session hook does`,
    );
  }
  if (r.status !== 0) throw new Error(`uv --version exited ${r.status}`);
  return r.stdout.trim();
}

/** The Python uv would start for the project, read without syncing. */
function uvPython(project) {
  const r = spawnSync("uv", ["python", "find", "--show-version", "--project", project], {
    encoding: "utf8",
  });
  if (r.error) {
    throw new Error(
      `uv could not be run (${r.error.code ?? r.error.message}); install it, the session hook does`,
    );
  }
  if (r.status !== 0) {
    throw new Error(
      `uv python find exited ${r.status}: ${(r.stderr || "").trim().split("\n").at(-1)}`,
    );
  }
  return r.stdout.trim();
}

function main(argv) {
  const say = (s) => console.error(`check:pins: ${s}`);
  const at = argv.indexOf("--root");
  if (at >= 0 && !argv[at + 1]) {
    say("cannot answer: --root needs a path");
    return 2;
  }
  // The project path is absolute, from this script's own location, so the
  // reading is the same from the root, barwise/ and a package
  // (gate-refusal-contract decision 3).
  const barwise = at >= 0
    ? resolve(argv[at + 1])
    : resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const repo = resolve(barwise, "..");
  const findings = [];
  let refusal = null;
  const refuse = (m) => {
    refusal ??= m;
  };

  let nvmrc;
  let workflows;
  try {
    nvmrc = readFileSync(join(repo, ".nvmrc"), "utf8");
    const dir = join(repo, ".github", "workflows");
    workflows = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => [
      `.github/workflows/${f}`,
      parse(readFileSync(join(dir, f), "utf8")),
    ]);
    if (workflows.length === 0) throw new Error("no workflows under .github/workflows");
  } catch (e) {
    say(`cannot answer: ${e.message}`);
    return 2;
  }
  findings.push(...workflowFindings(workflows));

  // A deleted hook loses the .nvmrc read as surely as an edited one, so it
  // is a finding, like a missing .python-version.
  const hook = join(repo, ".claude", "hooks", "session-start.sh");
  if (!existsSync(hook)) {
    findings.push(".claude/hooks/session-start.sh is missing, so nothing reads .nvmrc there");
  } else if (!hookReadsNvmrc(readFileSync(hook, "utf8"))) {
    findings.push(".claude/hooks/session-start.sh does not read .nvmrc");
  }

  const pins = {};
  for (
    const [label, path] of [
      [".python-version", join(repo, ".python-version")],
      ["barwise/.python-version", join(barwise, ".python-version")],
    ]
  ) {
    if (!existsSync(path)) {
      findings.push(
        `${label} is missing${
          label.startsWith("barwise") ? "; uv reads the pin only beside pyproject.toml" : ""
        }`,
      );
      continue;
    }
    pins[label] = readFileSync(path, "utf8");
    const problem = pythonPinProblem(pins[label]);
    if (problem) findings.push(`${label} ${problem}`);
  }

  // The uv first: read what runs before anything else, so the summary names
  // it whatever else fails. A missing installer or VERSION line is a fact
  // about the tree, so a finding; a uv that cannot run, or runs another
  // version, is about this machine, so a refusal, as for Node.
  let uv = null;
  try {
    uv = uvVersion();
  } catch (e) {
    refuse(e.message);
  }
  let pinned = null;
  const installer = join(barwise, "scripts", "install-uv.sh");
  if (!existsSync(installer)) {
    findings.push("scripts/install-uv.sh is missing, so there is no uv pin to hold");
  } else {
    try {
      pinned = installerVersion(readFileSync(installer, "utf8"));
    } catch (e) {
      findings.push(e.message);
    }
  }
  if (uv !== null && pinned !== null) {
    const problem = uvVersionProblem({ pinned, reported: uv });
    if (problem) refuse(problem);
  }

  let python = null;
  try {
    python = uvPython(barwise);
  } catch (e) {
    refuse(e.message);
  }
  // Held against the copy uv read, beside pyproject.toml; when that copy is
  // missing or malformed, the finding above stands and only Node is read.
  const uvPin = pins["barwise/.python-version"];
  const usable = uvPin !== undefined && !pythonPinProblem(uvPin);
  const r = runningProblem({
    nvmrc,
    node: process.version,
    pin: usable && python !== null ? uvPin : undefined,
    python,
  });
  if (r) refuse(r);

  const ran = `ran Node ${process.version} (.nvmrc ${nvmrc.trim()}), Python ${
    python ?? "unknown"
  } (barwise/.python-version ${(uvPin ?? "missing").trim()}), ${uv ?? "uv unknown"}`;
  for (const f of findings) say(f);
  if (findings.length > 0) {
    say(`FAIL -- ${findings.length} finding(s); ${ran}.`);
    if (refusal) say(`also could not vouch for the runtimes: ${refusal}`);
    return 1;
  }
  if (refusal) {
    say(`cannot answer: ${refusal}; ${ran}.`);
    return 2;
  }
  const patch = nodeParts(process.version).join(".") === nodeParts(nvmrc).join(".")
    ? ""
    : " (Node patch differs from .nvmrc; printed, not refused)";
  say(
    `${workflows.length} workflows read Node from .nvmrc, both .python-version files pin a minor; ${ran}${patch}. OK`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Anything unforeseen (an unreadable pin, a directory where a file should
  // be) is "could not answer", never the finding code
  // (docs/adr/gate-refusal-contract.md).
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(`check:pins: cannot answer: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 2;
  }
}
