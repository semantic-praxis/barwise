#!/usr/bin/env node
/**
 * Every path and `node <path>` command an instruction file cites must
 * resolve (docs/specs/instruction-reference-check.spec.md, WS1).
 *
 * An instruction file -- CLAUDE.md or AGENTS.md at any depth, any .md
 * under .claude/ -- is code that runs in an agent's head, and a path it
 * cites is a copy of a fact the repository owns. The 2026-10-04 prompt
 * audit found 26 such copies stale by hand, among them
 * `node scripts/beads-crud.mjs` at five sites where it does not resolve
 * from the directory the text says to run it from (barwise-52b). A sweep
 * run by hand runs once; this is the mechanical half of it as a gate.
 *
 * Resolution, per the spec:
 *   rooted   (`barwise/`, `.claude/`, `.github/`, `.beads/`) -- that exact
 *            tracked path;
 *   relative (`./`, `../`) -- from the citing file's directory;
 *   unrooted -- from the citing file's directory, then the repo root, else
 *            EXACTLY ONE tracked path that ends with `/` + it. Several is
 *            ambiguous: a reference to a file that moved while a
 *            namesake stayed would otherwise pass.
 *   `node <path>` -- from the repo root, or from the citing file's
 *            directory (a package CLAUDE.md says to run its commands there).
 * Untracked files never resolve, ignored or not: `git check-ignore`
 * cannot tell a build output from a typo under `dist/`. A legitimately
 * untracked mention is an ALLOWLIST row with its reason; a row that
 * matches nothing fails, so a fixed site forces its row out.
 *
 * Exit 0 clean, 1 a dead/ambiguous reference or stale row, 2 could not
 * see its input (lib/tracked.mjs refuses an empty listing).
 */
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { REPO_ROOT, trackedFiles } from "./lib/tracked.mjs";

/**
 * Mentions of files that are legitimately not tracked, read from the JSON
 * beside this script so a sandbox test can supply its own.
 */
const ALLOWLIST = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "instruction-refs-allowlist.json"),
    "utf8",
  ),
).rows;

const ROOTED = /^(barwise|\.claude|\.github|\.beads)\//;
const EXT = /\.(mjs|cjs|ts|tsx|js|json|md|yaml|yml|sh|py|toml|txt)$/;

function isInstructionFile(f) {
  return /(^|\/)(CLAUDE|AGENTS)\.md$/.test(f) || (f.startsWith(".claude/") && f.endsWith(".md"));
}

/** The candidate path a backticked token names, or null. Spec: Resolution rules. */
function candidate(raw) {
  if (/\s|[*<>{}$|]/.test(raw) || /^(https?:|[@~/-])/.test(raw)) return null;
  const t = raw.replace(/:\d+(-\d+)?$/, "");
  if (/^[\w.-]+\/$/.test(t)) return null; // a bare directory name: a kind, not a location
  if (/^\.[\w-]+(\.[\w-]+)?$/.test(t)) return null; // a bare file-type name
  const rel = t.startsWith("./") || t.startsWith("../");
  if (rel) return EXT.test(t) ? { kind: "relative", path: t } : null;
  if (ROOTED.test(t)) return { kind: "rooted", path: t.replace(/\/$/, "") };
  if (t.includes("/")) {
    return EXT.test(t) || t.endsWith("/") ? { kind: "unrooted", path: t.replace(/\/$/, "") } : null;
  }
  return EXT.test(t) && /^[\w.-]+$/.test(t) ? { kind: "unrooted", path: t } : null;
}

const all = trackedFiles();
const entries = new Set(all);
for (const f of all) {
  const parts = f.split("/");
  for (let i = 1; i < parts.length; i++) entries.add(parts.slice(0, i).join("/"));
}
const list = [...entries];
const files = all.filter(isInstructionFile);
// trackedFiles() refuses an empty listing; this refuses an empty FILTER.
// A repository always has CLAUDE.md, so zero instruction files means the
// filter or the listing went wrong, and "OK -- 0 files" would be a pass
// over nothing (Copilot on #626).
if (files.length === 0) {
  console.error(
    `check-instruction-refs: ${all.length} tracked file(s), none of them an instruction file.`,
  );
  console.error("Could not answer; refusing rather than reporting a clean scan of nothing.");
  process.exit(2);
}

const findings = [];
const allowHits = new Set();
function report(file, line, token, why) {
  const row = ALLOWLIST.findIndex((a) => a.file === file && a.token === token);
  if (row >= 0) allowHits.add(row);
  else findings.push(`${file}:${line}: \`${token}\` -- ${why}`);
}

for (const file of files) {
  const own = dirname(file);
  const lines = readFileSync(join(REPO_ROOT, file), "utf8").split("\n");
  for (const [i, text] of lines.entries()) {
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
      const raw = m[1].trim();
      const c = candidate(raw);
      if (!c) continue;
      const here = normalize(join(own, c.path));
      if (c.kind === "rooted") {
        if (!entries.has(c.path)) {
          report(file, i + 1, raw, "no tracked file or directory at that path");
        }
      } else if (c.kind === "relative") {
        if (!entries.has(here)) report(file, i + 1, raw, `does not resolve from ${own}/`);
      } else if (!entries.has(here) && !entries.has(c.path)) {
        // Own directory first, then the repo root: `CLAUDE.md` in a skill
        // means the root one, which 13 package CLAUDE.md files also end
        // with. Only a token that is neither is resolved by suffix.
        const hits = list.filter((e) => e === c.path || e.endsWith(`/${c.path}`));
        if (hits.length === 0) report(file, i + 1, raw, "no tracked path ends with it");
        else if (hits.length > 1) {
          report(
            file,
            i + 1,
            raw,
            `ambiguous, ${hits.length} tracked paths end with it: ${hits.join(", ")}`,
          );
        }
      }
    }
    // `node <path>` for .js/.mjs/.cjs, including the repository's canonical
    // `node "$(git rev-parse --show-toplevel)/<path>"` (root CLAUDE.md),
    // which names a root-relative path and resolves from the root only.
    for (
      const m of text.matchAll(
        /\bnode\s+(?:--test\s+)?"?(\$\(git rev-parse --show-toplevel\)\/)?([\w./-]+\.[cm]?js)\b/g,
      )
    ) {
      const [, fromTop, p] = m;
      const ok = entries.has(normalize(p)) || (!fromTop && entries.has(normalize(join(own, p))));
      if (!ok) {
        const where = fromTop ? "the repo root" : `the repo root nor from ${own}/`;
        report(file, i + 1, `node ${fromTop ?? ""}${p}`, `resolves neither from ${where}`);
      }
    }
  }
}

for (const [i, a] of ALLOWLIST.entries()) {
  if (!allowHits.has(i)) {
    findings.push(`ALLOWLIST: ${a.file} \`${a.token}\` matches nothing; remove the row.`);
  }
}

if (findings.length > 0) {
  console.error(`check-instruction-refs: FAIL -- ${findings.length} finding(s):`);
  for (const f of findings) console.error(`  ${f}`);
  console.error(
    "Fix the reference, qualify an ambiguous one, or add an ALLOWLIST row with its reason.",
  );
  process.exit(1);
}
console.log(
  `check-instruction-refs: OK -- ${files.length} instruction file(s), every path and node command resolves `
    + `(${ALLOWLIST.length} allowlisted).`,
);
