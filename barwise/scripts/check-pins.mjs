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

/** A refusal when the running versions are not the pinned ones, or null. */
export function runningProblem({ nvmrc, node, pin, python }) {
  const want = nvmrc.trim().replace(/^v/, "").split(".")[0];
  const have = node.replace(/^v/, "").split(".")[0];
  if (want !== have) return `Node ${node} is running, another major than .nvmrc's ${nvmrc.trim()}`;
  const [, major, minor] = MINOR.exec(pin.trim()) ?? [];
  const m = /^(\d+)\.(\d+)/.exec(python ?? "");
  if (!m) return `uv resolved no Python version for the project (read "${python}")`;
  if (m[1] !== major || m[2] !== minor) {
    return `uv resolves Python ${python} for the project, another minor than .python-version's ${pin.trim()}`;
  }
  return null;
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

  const hook = join(repo, ".claude", "hooks", "session-start.sh");
  if (!existsSync(hook)) refuse("the session hook would not read");
  else if (!/\.nvmrc/.test(readFileSync(hook, "utf8").replace(/^\s*#.*$/gm, ""))) {
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

  let python = null;
  try {
    python = uvPython(barwise);
  } catch (e) {
    refuse(e.message);
  }
  if (python !== null && pins[".python-version"] && !pythonPinProblem(pins[".python-version"])) {
    const r = runningProblem({
      nvmrc,
      node: process.version,
      pin: pins[".python-version"],
      python,
    });
    if (r) refuse(r);
  } else if (
    !refusal && process.version.replace(/^v/, "").split(".")[0] !== nvmrc.trim().split(".")[0]
  ) {
    refuse(`Node ${process.version} is running, another major than .nvmrc's ${nvmrc.trim()}`);
  }

  const ran = `ran Node ${process.version} (.nvmrc ${nvmrc.trim()}), Python ${
    python ?? "unknown"
  } (.python-version ${(pins[".python-version"] ?? "missing").trim()})`;
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
  const patch = process.version.replace(/^v/, "") === nvmrc.trim()
    ? ""
    : " (Node patch differs from .nvmrc; printed, not refused)";
  say(
    `${workflows.length} workflows read Node from .nvmrc, both .python-version files pin a minor; ${ran}${patch}. OK`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
