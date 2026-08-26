#!/usr/bin/env node
// Blocking dependency-advisory gate -- docs/specs/supply-chain-hardening.spec.md.
//
// Replaces `npm audit --audit-level=high || true` in CI. That form could
// not fail, so the build reported green over 20 high and 2 critical
// advisories for as long as anyone had been reading it. The difference
// here is not the scan -- it is the same `npm audit` -- but that an
// advisory has exactly two fates: fixed, or written down in ACCEPTED
// with a date it stops being acceptable.
//
// Exits 1 on any high/critical advisory that is not accepted, and on any
// acceptance that has expired. Exits 0 otherwise.
//
// Usage: node barwise/scripts/audit-gate.mjs [threshold]
//   threshold: lowest severity that blocks (default "high")

import { spawnSync } from "node:child_process";

const SEVERITY = ["info", "low", "moderate", "high", "critical"];
const threshold = process.argv[2] ?? "high";
const minRank = SEVERITY.indexOf(threshold);
if (minRank < 0) {
  console.error(`audit-gate: unknown severity "${threshold}"`);
  process.exit(2);
}

// Advisories we have looked at and decided not to act on yet.
//
// `expires` is the honesty mechanism, not bookkeeping: an acceptance that
// cannot expire is indistinguishable from the `continue-on-error` this
// gate replaced. Past the date the build fails until someone re-argues
// the entry, whether or not the advisory itself changed.
//
// Every entry needs a reason that would survive being read aloud in a
// post-incident review. "Dev dependency" is not one; "the code path is
// not reachable, and here is why" is.
const ACCEPTED = [
  {
    ghsa: "GHSA-5c6j-r48x-rmvq",
    package: "serialize-javascript",
    expires: "2026-11-30",
    reason: "RCE via RegExp.flags. Reachable only through mocha, which only "
      + "@vscode/test-cli depends on, which only `npm run test:integration` "
      + "in packages/vscode runs -- a command CI does not run and that "
      + "executes our own test files. No upstream fix: mocha 11.8.0 (latest) "
      + "declares serialize-javascript ^6.0.2 and the fix is 7.1.0, so the "
      + "only routes are downgrading mocha or forcing a major it has never "
      + "been tested against. Revisit when mocha widens the range.",
  },
];

const res = spawnSync("npm", ["audit", "--json"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

// `npm audit` exits non-zero whenever it finds anything, so the exit code
// says nothing about whether the scan succeeded. Unparseable stdout does.
let report;
try {
  report = JSON.parse(res.stdout);
} catch {
  console.error("audit-gate: could not parse `npm audit --json` output.");
  console.error(res.stderr?.trim() || res.stdout?.slice(0, 2000) || "(no output)");
  process.exit(2);
}

if (report.error) {
  console.error(`audit-gate: npm audit failed -- ${report.error.summary ?? "unknown error"}`);
  process.exit(2);
}

// Flatten to advisories rather than to the packages npm groups them
// under. A package's own severity is a rollup of its dependencies', so
// gating on packages would demand a separate acceptance for every
// intermediate hop (mocha, @vscode/test-cli) that carries no advisory of
// its own. Accepting the advisory clears the whole chain at once.
const advisories = new Map();
for (const entry of Object.values(report.vulnerabilities ?? {})) {
  for (const via of entry.via ?? []) {
    if (typeof via === "string") continue; // a rollup edge, not an advisory
    const ghsa = (via.url ?? "").split("/").pop() || via.source;
    if (!advisories.has(ghsa)) {
      advisories.set(ghsa, {
        ghsa,
        package: via.name ?? entry.name,
        severity: via.severity ?? "info",
        title: via.title ?? "",
        url: via.url ?? "",
      });
    }
  }
}

const blocking = [...advisories.values()]
  .filter((a) => SEVERITY.indexOf(a.severity) >= minRank)
  .sort((a, b) => SEVERITY.indexOf(b.severity) - SEVERITY.indexOf(a.severity));

const today = new Date().toISOString().slice(0, 10);
const accepted = [];
const unreviewed = [];
const expired = [];

for (const advisory of blocking) {
  const exception = ACCEPTED.find((e) => e.ghsa === advisory.ghsa);
  if (!exception) unreviewed.push(advisory);
  else if (exception.expires < today) expired.push({ advisory, exception });
  else accepted.push({ advisory, exception });
}

// Stale acceptances warn rather than fail. An entry goes stale exactly
// when upstream ships the fix, and turning that into a red build teaches
// people to distrust the gate.
const stale = ACCEPTED.filter((e) => !advisories.has(e.ghsa));

const counts = report.metadata?.vulnerabilities ?? {};
const below = SEVERITY.slice(0, minRank).reduce((n, s) => n + (counts[s] ?? 0), 0);

const line = (a) => `  ${a.severity.padEnd(8)} ${a.package.padEnd(28)} ${a.ghsa}\n    ${a.title}`;

console.log(`audit-gate: blocking at severity >= ${threshold}`);
console.log(`  ${below} advisory/advisories below threshold (not gated)\n`);

for (const { advisory, exception } of accepted) {
  console.log(`ACCEPTED until ${exception.expires}:`);
  console.log(line(advisory));
  console.log();
}

for (const { advisory, exception } of expired) {
  console.error(`EXPIRED ${exception.expires} -- re-argue this entry or fix it:`);
  console.error(line(advisory));
  console.error();
}

for (const advisory of unreviewed) {
  console.error("UNREVIEWED:");
  console.error(line(advisory));
  console.error(`    ${advisory.url}`);
  console.error();
}

for (const exception of stale) {
  console.log(
    `note: acceptance for ${exception.ghsa} (${exception.package}) matches no current `
      + "advisory -- it can be deleted from ACCEPTED.",
  );
}

if (expired.length || unreviewed.length) {
  console.error(
    `audit-gate: FAIL -- ${unreviewed.length} unreviewed, ${expired.length} expired.\n`
      + "Fix the advisory, or add it to ACCEPTED in this file with a reason and an "
      + "expiry date.",
  );
  process.exit(1);
}

console.log(`audit-gate: PASS -- ${accepted.length} accepted, 0 unreviewed.`);
