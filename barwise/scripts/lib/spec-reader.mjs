/**
 * What a spec says about itself: its header fields and the repository
 * paths it plans to change (docs/specs/plan-scope-check.spec.md, WS2).
 *
 * One reader for every script that asks. `audit-spec-status` decides
 * which paths a spec names, and the scope report and the plan-review
 * check ask the same question; a second parser would be the must-agree
 * copy root CLAUDE.md forbids. Pure: the caller supplies `exists`, so the
 * same reader serves the working tree and a historical `--at` tree.
 */
import { matchesPattern } from "./review-tiers.mjs";

/**
 * The specs the audit and check:spec-touches read: tracked specs,
 * archived ones excepted. An archived spec is a frozen record, and a gate
 * failing on its header would ask someone to rewrite history.
 */
export function inSpecCorpus(f) {
  return f.startsWith("barwise/docs/specs/") && f.endsWith(".spec.md") && !f.includes("/archive/");
}

/**
 * The tracked paths a `Touches:` entry stands for: itself, or for a
 * pattern (review-tiers' language: `*` is one whole segment, `x/` a
 * directory), every tracked path it matches.
 */
export function entryPaths(path, files) {
  return path.includes("*") ? files.filter((f) => matchesPattern(f, path)) : [path];
}

/** Extensions the audit treats as code. Markdown and the like are not. */
export const CODE = /\.(ts|tsx|mjs|cjs|js|json|ya?ml|py|sh)$/;

/**
 * A package barrel is touched by every change to its package, so a spec
 * naming one fires on work that has nothing to do with it. Measured:
 * `core/src/index.ts` alone accounted for every false signal in the
 * audit's prototype sweep. Excluding barrels is what keeps it a signal.
 */
export const HUB = /(^|\/)(index|registration)\.ts$/;

/**
 * Shared wiring: planned by many specs, owned by none. A `Touches:` entry
 * under one of these is a planned change for the scope report and plan
 * review, and is ignored by the audit -- otherwise every commit touching
 * ci.yml would make every Draft spec that lists it look stale.
 */
export const WIRING = [
  ".github/workflows/",
  "package.json",
  "barwise/package.json",
  "CLAUDE.md",
  "barwise/scripts/tests/",
  "barwise/docs/specs/",
  ".beads/",
];

export function isWiring(path) {
  return WIRING.some((w) => (w.endsWith("/") ? path.startsWith(w) : path === w));
}

/**
 * The header block: the lines after the title and before the first `##`
 * heading. Fields are read only here, so an example of a field inside a
 * code block in the body is never taken as the spec's own.
 */
export function headerBlock(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith("# ")) + 1;
  const end = lines.findIndex((l, i) => i >= start && l.startsWith("## "));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

/**
 * A header value, which may run over several lines. `Tracking:` usually
 * does -- it mixes issue ids, sibling specs and review documents across a
 * paragraph -- and reading only its first line silently loses the ids on
 * the rest. That is not hypothetical: it dropped `norma-export`'s three
 * issues and one of `mandatory-existence-witness`'s two, which moved both
 * specs into the wrong survey class. A value ends at the next header
 * field or the first blank line, and is read from the header block only.
 */
export function header(text, field) {
  const m = new RegExp(
    // `$` is NOT the terminator: under the `m` flag it matches at every
    // line end, so the lookahead fires immediately and the value is
    // truncated to its first line. `(?![\\s\\S])` is end of input.
    `^${field}:[ \\t]*([\\s\\S]*?)(?=\\n[A-Z][A-Za-z-]*:[ \\t]|\\n[ \\t]*\\n|(?![\\s\\S]))`,
    "m",
  ).exec(headerBlock(text));
  return m ? m[1].trim() : undefined;
}

/**
 * The spec's `Touches:` entries, or undefined when it has none. Each is
 * `{ path, mark }`: `+` a file the plan creates (may be absent), `-` one
 * it deletes (may be gone), `""` one that must be tracked.
 */
export function touches(text) {
  const value = header(text, "Touches");
  if (value === undefined) return undefined;
  return value.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const mark = s[0] === "+" || s[0] === "-" ? s[0] : "";
    // Trimmed after the mark, so `+ path` is `path`, not " path", which
    // would skip the gate (marked) and match nothing in the audit.
    return { path: (mark ? s.slice(1) : s).trim(), mark };
  });
}

/**
 * Repo paths a spec names in backticks. Specs write them relative to
 * `barwise/`, to `barwise/packages/`, or from the repo root, so each
 * candidate is tried against all three and kept only if `exists` knows
 * it. The defaults are the audit's; the options widen it for the scope
 * report, which also counts directories, non-code files, bare root
 * names and barrels as planned.
 */
export function namedPaths(text, exists, opts = {}) {
  const { dirs = false, anyExtension = false, bare = false, barrels = false } = opts;
  const out = new Set();
  const token = bare ? /`([^`\s]+)`/g : /`([^`\s]+\/[^`\s]+)`/g;
  for (const m of text.matchAll(token)) {
    const raw = m[1].replace(/[.,;:)]+$/, "");
    const isDir = raw.endsWith("/");
    if (isDir) {
      if (!dirs) continue;
    } else if (!(anyExtension ? /\.[A-Za-z0-9]+$/ : CODE).test(raw)) {
      continue;
    }
    if (!barrels && HUB.test(raw)) continue;
    const clean = raw.replace(/\/$/, "");
    for (const cand of [clean, `barwise/${clean}`, `barwise/packages/${clean}`]) {
      if (exists(cand)) {
        out.add(isDir ? `${cand}/` : cand);
        break;
      }
    }
  }
  return [...out];
}
