#!/usr/bin/env node
/**
 * Refuse credentials in committed content. Detection is gitleaks'.
 *
 * Every other gate in ci.yml guards something a follow-up commit fixes: a
 * NUL byte, a non-portable shell script, an unpinned Python call, a stale
 * spec header, a drifted copy. A committed credential is not in that
 * class. Reverting does not un-leak it, deleting the branch does not
 * un-leak it, and rewriting history does not un-leak it -- the key has to
 * be ROTATED, by a person, in a provider console. It was the only
 * irreversible defect in that list and the only one with no gate
 * (docs/specs/credential-scanning.spec.md, barwise-1021).
 *
 * What stood in for this gate was `.gitignore` covering `.env`, `.env.*`
 * and `.beads-credential-key`. That is a shadow: it correlates with "no
 * credential is committed" through the mechanism *credentials live in
 * dotenv files*, and it diverges exactly where that mechanism is
 * bypassed. Three bypasses are live in this repository rather than
 * hypothetical -- `eval-payloads/` and `eval-runs/` are TRACKED and
 * machine-written during an eval round (with a deliberate .gitignore
 * negation un-ignoring logs there), documentation shows commands, and
 * fixtures imitate real payloads. None of the three is a `.env` file.
 *
 * WHY THIS FILE DETECTS NOTHING ITSELF. The first version of this gate
 * carried ten hand-written vendor-prefix regexes. gitleaks maintains
 * about 150 rules with an entropy model and per-rule allowlists, and
 * keeping a private rule table in step with the providers of the world is
 * work this project would lose at. The wrapper exists for what gitleaks
 * does not do, which is this repository's gate contract:
 *
 *   - the third result. gitleaks exits 1 for "found something" and
 *     non-zero-non-1 for "could not run". Those are pass/fail/refuse and
 *     must not collapse, because a gate that says PASS when it could not
 *     look is the defect docs/specs/gate-refusal-contract.spec.md exists
 *     to forbid.
 *   - the shallow-clone refusal. A history scan of a shallow clone reads
 *     as a clean bill of health over whatever few commits arrived.
 *   - an npm script, so `lib/ci-gates.mjs` derives this gate from ci.yml
 *     and `ci:local`, the pre-push hook and `fault-matrix` pick it up
 *     with no registration.
 *   - the rotation instruction, which is the one thing a reader needs and
 *     no scanner says.
 *
 * The mode split follows gitleaks' own intended usage rather than
 * inventing a third: `--staged` at the commit, full history in CI.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./lib/tracked.mjs";

const STAGED = process.argv.includes("--staged");

function refuse(what, detail) {
  process.stderr.write(
    `check-secrets: ${what}\n${detail ? `  ${detail}\n` : ""}`
      + "  Refusing rather than reporting a clean scan it could not perform.\n",
  );
  process.exit(2);
}

const version = (() => {
  const r = spawnSync("gitleaks", ["version"], { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    refuse(
      "gitleaks is not installed, so this gate cannot answer its question.",
      "Install the pinned version: bash barwise/scripts/install-gitleaks.sh",
    );
  }
  return r.stdout.trim();
})();

// Only the history scan depends on depth. `--staged` reads the index, which
// a shallow clone has in full -- so the pre-commit path keeps working in a
// session container whether or not anyone unshallowed it.
if (!STAGED) {
  const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  if (shallow === "true") {
    refuse(
      "this is a SHALLOW clone, so the history it would scan is not the history.",
      "Fix: git fetch --unshallow  (CI checks out with fetch-depth: 0)."
        + " A clean reading here would be about the few commits present, not about the repository.",
    );
  }
}

// --redact so a finding never reaches a CI log in the clear. CI logs are
// retained and searchable, so an echoing gate would become a second durable
// copy of the leak; gitleaks prints the rule, file and line either way,
// which is what a reader needs to find it.
// --config explicitly, rather than relying on gitleaks finding
// `.gitleaks.toml` beside the scan target: this gate is invoked from at
// least three cwds and an auto-discovered config is one more thing whose
// presence depends on where you stood. The same reason `lib/tracked.mjs`
// anchors its listing.
const config = join(REPO_ROOT, ".gitleaks.toml");
if (!existsSync(config)) {
  // Refuse rather than let gitleaks fall back to its bundled defaults. The
  // fallback would still find most things and would silently drop the one
  // rule this repository added because the default set does not have it --
  // the Anthropic key, which is the credential barwise is most likely to
  // leak. A gate quietly running a weaker rule set than it claims is the
  // shape this whole spec is about.
  refuse(
    `no .gitleaks.toml at ${config}, so the Anthropic rule would be silently absent.`,
    "Restore it from git; gitleaks' defaults do not cover sk-ant- keys.",
  );
}

// --verbose is not optional decoration: without it gitleaks reports only
// "leaks found: 1" and the reader gets no rule, no file and no line. With
// it, each finding prints its RuleID, File, Line and Fingerprint -- and the
// fingerprint is exactly what a genuine false positive needs in
// .gitleaksignore, so the failure output states its own remedy.
const args = ["git", "--redact", "--verbose", "--no-banner", "--config", config];
if (STAGED) args.push("--staged");
args.push(REPO_ROOT);

const run = spawnSync("gitleaks", args, { encoding: "utf8" });

if (run.error) {
  refuse("gitleaks could not be executed.", run.error.message);
}

// The three-way split this wrapper exists for. gitleaks uses 1 for
// findings; any OTHER non-zero status is the tool failing to run, which is
// "could not answer" and must not be reported as a finding -- that would
// send the reader hunting a credential that was never there.
if (run.status !== 0 && run.status !== 1) {
  refuse(
    `gitleaks exited ${run.status}, which is neither clean nor a finding.`,
    (run.stderr || "").trim().split("\n").slice(-3).join(" ") || "no diagnostic output",
  );
}

if (run.status === 1) {
  process.stderr.write(`${run.stdout}${run.stderr}\n`);
  process.stderr.write(
    "Credential-shaped content found by gitleaks (secrets redacted above).\n"
      + "\nIf any of these is a real credential, ROTATE IT FIRST. Removing the\n"
      + "line, amending the commit and rewriting history all leave the key\n"
      + "valid and already disclosed.\n"
      + "\nIf it is not a credential, record the finding's fingerprint in\n"
      + ".gitleaksignore with a comment saying why -- not a broadened rule.\n",
  );
  process.exit(1);
}

const scope = STAGED ? "staged changes" : "all reachable commits";
console.log(
  `check-secrets: ${scope}, gitleaks ${version}, no credentials found. OK`,
);
