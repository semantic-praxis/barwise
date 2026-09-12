#!/usr/bin/env node
/**
 * Refuse credentials in tracked files.
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
 * TWO RULES ABOUT THIS FILE'S OWN CONTENT, both load-bearing:
 *
 *   1. The gate scans every tracked file, including itself, its tests and
 *      its spec -- all three of which necessarily discuss the patterns
 *      they match. So the patterns are spelled as regexes with character
 *      classes and never as a sample key, and the tests build their
 *      probes by concatenation at runtime. Same idiom as `NUL` at the top
 *      of scripts/tests/gates.test.mjs, and the failure it prevents is
 *      this gate failing on itself.
 *
 *   2. A match is NEVER printed. A gate that echoes what it found writes
 *      the credential into a CI log, and CI logs are retained,
 *      searchable and frequently public -- so a gate built to reduce
 *      exposure would become a second, durable copy of it. The report
 *      carries file, line, detector and match LENGTH: enough to find the
 *      line, nothing that helps use the key.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { REPO_ROOT, trackedFiles } from "./lib/tracked.mjs";

/**
 * Anchored on vendor prefixes, not on entropy, and the reason is this
 * repository specifically.
 *
 * `package-lock.json` carries an `integrity: sha512-` value per entry,
 * the prompt lane records a `promptHash` per run, and
 * packages/diagram-ui/tests/golden/ holds serialised SVG. Every one is a
 * long high-entropy base64-or-hex string, and on the attribute an
 * entropy rule measures they are indistinguishable from a secret. That
 * is not a threshold to tune: entropy is a shadow of "this is a
 * credential" through the mechanism *credentials are random*, bypassed
 * by every other random string in the tree. A vendor's own prefix is a
 * namespace the vendor controls and nothing else emits by accident.
 *
 * A false positive here blocks every commit in the repository, which is
 * how a gate gets switched off. Measured before it was trusted: 1602
 * files, 15.5 MB, 0 findings, against 10 of 10 detectors firing on a
 * synthetic sample of their own shape and 0 hits on six decoys.
 */

/**
 * Refuse a match that sits inside a longer base64 run.
 *
 * The token detectors below start with a word character, so plain `\b`
 * would happily match `ghp_...` embedded at a `-` inside a base64url
 * digest -- and base64url's alphabet includes `-` and `_`. Lockfile
 * integrity values are 88 characters of it, thousands of times over, so
 * "unlikely per position" is the wrong unit. Excluding the whole base64
 * alphabet from the preceding character costs nothing (a real key is
 * preceded by a quote, a space, `=` in a shell assignment, or nothing)
 * and removes the one false-positive path anchoring leaves open.
 */
const NOT_IN_BASE64 = "(?<![A-Za-z0-9_/+=-])";

/** Prefix-token detectors: the vendor namespace plus a length floor. */
const TOKEN_DETECTORS = [
  // Anthropic. `sk-ant-` then a key-class segment then the body.
  ["anthropic-api-key", "sk-ant-[A-Za-z0-9]{2,}-[A-Za-z0-9_-]{24,}"],
  // OpenAI, legacy and project-scoped. The negative lookahead keeps this
  // from double-reporting every Anthropic key above.
  ["openai-api-key", "sk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{32,}"],
  // GitHub's documented token formats: ghp_/gho_/ghu_/ghs_/ghr_ + 36.
  ["github-token", "gh[pousr]_[A-Za-z0-9]{36}"],
  ["github-pat", "github_pat_[A-Za-z0-9_]{22,}"],
  // AWS access key ids. AKIA is long-lived, ASIA is an STS session key.
  ["aws-access-key-id", "(?:AKIA|ASIA)[0-9A-Z]{16}"],
  ["slack-token", "xox[abporsa]-[A-Za-z0-9-]{10,}"],
  ["google-api-key", "AIza[0-9A-Za-z_-]{35}"],
  ["npm-token", "npm_[A-Za-z0-9]{36}"],
].map(([name, body]) => ({ name, re: new RegExp(NOT_IN_BASE64 + body, "g") }));

/**
 * Phrase-anchored detectors, which do NOT take the base64 guard.
 *
 * Both are anchored by a literal phrase rather than a token prefix, and
 * the PEM armour line begins with `-` -- a guard excluding `-` from the
 * preceding character would refuse to match it after one more dash.
 */
const PHRASE_DETECTORS = [
  {
    name: "aws-secret-access-key",
    re: /aws_secret_access_key["'\s]*[=:]["'\s]*[A-Za-z0-9/+=]{40}/gi,
  },
  { name: "private-key-block", re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g },
];

const DETECTORS = [...TOKEN_DETECTORS, ...PHRASE_DETECTORS];

/**
 * Declared exceptions: a finding that is known not to be a credential.
 *
 * Shape: `{ file, detector, reason }`. Empty, because the tree is clean
 * -- which is the right condition in which to add a blocking gate.
 *
 * A stale entry FAILS the gate, the way audit-baseline.json and
 * rubric-baseline.json fail on a row no longer detected. An allowlist
 * that silently outlives its file is how the next real finding gets
 * suppressed by a line nobody reads. No expiry date: unlike a security
 * advisory, a test fixture that is fine today is fine next quarter, and
 * an expiry would fail the build to ask a question with a known answer.
 */
const ALLOWLIST = [];

// Extensions whose bytes are not text. A DENYLIST rather than
// check-no-nul's allowlist of text extensions, and the inversion is
// deliberate: for a security scan the safe default is to read the file.
// An allowlist silently skips `.pem`, `.key`, `.cfg`, `.tfvars` and
// whatever extension the next leak arrives under, and skipping reads as
// a clean scan.
const BINARY_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".bmp",
  ".pdf",
  ".zip",
  ".gz",
  ".tgz",
  ".vsix",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".mp4",
  ".mov",
  ".webm",
  ".wasm",
  ".bin",
  ".node",
]);

const MAX_BYTES = 8 * 1024 * 1024;

function refuse(what, detail) {
  process.stderr.write(
    `check-secrets: ${what}\n${detail ? `  ${detail}\n` : ""}`
      + "  Refusing rather than reporting a clean scan over input it could not read.\n",
  );
  process.exit(2);
}

/** Findings for one buffer, or [] if it is binary. Never returns the match. */
function scan(where, buf) {
  // A NUL in the head is git's own binary test, and it is the one that
  // matters here: a file with no known-binary extension can still be
  // binary, and decoding it as UTF-8 would produce replacement
  // characters rather than a match.
  if (buf.subarray(0, 8192).includes(0)) return [];

  const text = buf.toString("utf8");
  const findings = [];
  for (const { name, re } of DETECTORS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      findings.push({
        where,
        detector: name,
        line: text.slice(0, m.index).split("\n").length,
        length: m[0].length,
      });
      // A zero-length match cannot happen with these patterns, but an
      // exec loop that does not advance hangs the gate rather than
      // failing it, and a hung gate reads as an infrastructure problem.
      if (m[0].length === 0) re.lastIndex += 1;
    }
  }
  return findings;
}

function report(findings) {
  console.error("Credential-shaped strings in tracked content:\n");
  for (const f of findings) {
    console.error(`  ${f.where}:${f.line}  ${f.detector}  (${f.length} characters)`);
  }
  console.error(
    "\nThe matched text is deliberately NOT printed: this output goes to CI\n"
      + "logs, which are retained and searchable.\n"
      + "\nIf any of these is a real credential, ROTATE IT FIRST. Removing the\n"
      + "line, amending the commit and rewriting history all leave the key\n"
      + "valid and already disclosed.\n"
      + "\nIf it is not a credential, add an entry to ALLOWLIST in\n"
      + "scripts/check-secrets.mjs with the file, the detector and the reason.\n",
  );
}

/**
 * Findings the allowlist covers, plus allowlist entries that covered
 * nothing. Both directions, for the reason the baselines ratchet both
 * ways: a list that only ever grows stops enumerating what is open.
 */
function applyAllowlist(findings) {
  const used = new Set();
  const kept = findings.filter((f) => {
    const i = ALLOWLIST.findIndex((a) => a.file === f.where && a.detector === f.detector);
    if (i === -1) return true;
    used.add(i);
    return false;
  });
  const stale = ALLOWLIST.filter((_, i) => !used.has(i));
  return { kept, stale };
}

function scanWorkingTree() {
  const tracked = trackedFiles();
  let scanned = 0;
  const findings = [];
  for (const file of tracked) {
    if (BINARY_EXT.has(extname(file).toLowerCase())) continue;
    const abs = resolve(REPO_ROOT, file);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue; // deleted in the working tree; not this gate's business
    }
    if (!st.isFile() || st.size > MAX_BYTES) continue;
    let buf;
    try {
      buf = readFileSync(abs);
    } catch {
      continue;
    }
    scanned += 1;
    findings.push(...scan(file, buf));
  }
  return { scanned, total: tracked.length, findings };
}

/**
 * Every blob in the object database, not just the ones a ref reaches.
 *
 * A credential that was committed and then "removed" by an amend or a
 * reset is exactly the case this mode exists for, and those blobs are
 * unreachable rather than gone. `--batch-all-objects` sees them;
 * `rev-list --all` does not.
 */
function scanHistory() {
  if (
    execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim() === "true"
  ) {
    refuse(
      "--history was asked of a SHALLOW clone, which does not contain the history.",
      "Run `git fetch --unshallow` (or clone without --depth) and try again."
        + " A clean reading here would be about the few commits present, not about the repository.",
    );
  }

  const listing = execFileSync(
    "git",
    ["cat-file", "--batch-all-objects", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );

  const blobs = [];
  for (const line of listing.split("\n")) {
    const [sha, type, size] = line.split(" ");
    if (type !== "blob") continue;
    if (Number(size) > MAX_BYTES) continue;
    blobs.push(sha);
  }
  if (blobs.length === 0) {
    refuse("`git cat-file --batch-all-objects` listed no blobs, so there is nothing to scan.");
  }

  // One `git cat-file --batch` for every blob: a spawn per blob turns a
  // 10-second audit into minutes. Output is `<sha> <type> <size>\n` then
  // exactly <size> bytes then `\n`, read as BYTES -- a blob may be
  // binary, so the stream cannot be decoded before it is split.
  const stream = execFileSync("git", ["cat-file", "--batch"], {
    cwd: REPO_ROOT,
    input: blobs.join("\n") + "\n",
    maxBuffer: 1024 * 1024 * 1024,
  });

  const findings = [];
  let at = 0;
  let scanned = 0;
  while (at < stream.length) {
    const nl = stream.indexOf(0x0a, at);
    if (nl === -1) break;
    const [sha, type, size] = stream.subarray(at, nl).toString("utf8").split(" ");
    if (type !== "blob") break; // "<sha> missing" -- the stream is no longer parseable
    const start = nl + 1;
    const end = start + Number(size);
    scanned += 1;
    findings.push(...scan(`blob ${sha.slice(0, 12)}`, stream.subarray(start, end)));
    at = end + 1; // the trailing newline git writes after the contents
  }
  if (scanned !== blobs.length) {
    refuse(
      `read ${scanned} of ${blobs.length} blobs before the batch stream stopped parsing.`,
      "A partial history scan must not report clean.",
    );
  }
  return { scanned, total: blobs.length, findings };
}

const history = process.argv.includes("--history");
const { scanned, total, findings } = history ? scanHistory() : scanWorkingTree();
const { kept, stale } = applyAllowlist(findings);

if (kept.length > 0) {
  report(kept);
  process.exit(1);
}

if (stale.length > 0) {
  console.error("check-secrets: ALLOWLIST entries that matched nothing:\n");
  for (const a of stale) {
    console.error(`  ${a.file}  ${a.detector}  -- ${a.reason}`);
  }
  console.error(
    "\nA stale exception suppresses a detector on a path where nothing is\n"
      + "found any more, which is how the next real finding gets hidden by a\n"
      + "line nobody reads. Delete the entry.\n",
  );
  process.exit(1);
}

const what = history
  ? `${scanned} blobs in the object database`
  : `${scanned} of ${total} tracked files`;
console.log(
  `check-secrets: ${what}, ${DETECTORS.length} detectors, no credentials found. OK`,
);
