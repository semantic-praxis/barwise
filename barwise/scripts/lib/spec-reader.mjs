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
  // A directory stands for the files under it, so the audit's filters
  // (wiring, code, barrels) apply to each, as they do to inferred paths.
  if (path.includes("*") || path.endsWith("/")) return files.filter((f) => matchesPattern(f, path));
  return [path];
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
 * The shape of Status that claims nothing exists yet. Shared by
 * audit:specs and check:plan-review, which ask the same question of a
 * Status: one at HEAD, the other at a pull request's merge base.
 *
 * Two alternatives, because the same claim appears in two positions. The
 * anchored one is the common case (`Draft ...`, `Proposed ...`). The
 * unanchored phrase catches it mid-line: `conformance-property.spec.md`
 * reads "Accepted (all decisions resolved 2026-08-25; both workstreams
 * open -- design only, no implementation in this PR)", which asserts
 * exactly what an anchored `Draft` does and escaped the audit purely on
 * where its author put it.
 *
 * This is NOT the widening to partial specs that barwise-912 warns
 * against. That would mean inferring from "workstreams 1 and 2
 * implemented" which ones actually shipped, which no header can settle.
 * This is the identical claim -- nothing was built -- matched wherever
 * it sits. "No workstream implemented" is the same claim in the words
 * two specs used on 2026-09-06, and both sat outside the audit for a
 * whole workstream of commits until the first PR to land one noticed
 * (#426, session review); the audit's test plants that exact phrasing.
 */
export const CLAIMS_NOTHING_BUILT =
  /^\s*(draft|proposed|design only)\b|\bno (implementation|workstreams? implemented)\b/i;

/**
 * The header block: the lines after the title and before the first `##`
 * heading. Fields are read only here, so an example of a field inside a
 * code block in the body is never taken as the spec's own.
 */
export function headerBlock(text) {
  const { lines, start, end } = headerBounds(text);
  return lines.slice(start, end).join("\n");
}

/**
 * Everything but the header block: the title and the body. The plan a
 * `Plan-reviewed:` line vouches for is this text, so adding that line (or
 * updating Status) after the review leaves it unchanged, while any edit
 * to the plan itself does not (plan-scope-check.spec.md, WS6).
 */
export function specBody(text) {
  const { lines, start, end } = headerBounds(text);
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

/** One boundary for the header block, so the two readers above split alike. */
function headerBounds(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith("# ")) + 1;
  const end = lines.findIndex((l, i) => i >= start && l.startsWith("## "));
  return { lines, start, end: end === -1 ? lines.length : end };
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
  // Commas or line ends: a wrapped header whose author dropped the comma
  // is still two entries, not one path with a newline in it.
  return value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const mark = s[0] === "+" || s[0] === "-" ? s[0] : "";
    // Trimmed after the mark, so `+ path` is `path`, not " path", which
    // would skip the gate (marked) and match nothing in the audit.
    return { path: (mark ? s.slice(1) : s).trim(), mark };
  });
}

/**
 * What the new-spec rule makes of a spec's `Touches:` entries
 * (docs/specs/touches-required.spec.md): "none" (no field), "empty" (a
 * field with no entries, which check:spec-touches already reports),
 * "marked-only" (only `+` entries, or `-` entries naming nothing tracked
 * at the base), or "satisfies". An unmarked entry satisfies, since the
 * tree rule holds it to a tracked path; a `-` entry satisfies when
 * `trackedAtBase(path)` says the base held it. `+` entries alone never
 * do, or `Touches: +none` would pass. Shared by the gate and
 * measure-touches-required, whose counts are the gate's acceptance test.
 */
export function newSpecVerdict(entries, trackedAtBase) {
  if (entries === undefined) return "none";
  if (entries.length === 0) return "empty";
  const real = entries.some((e) =>
    e.mark === "" || (e.mark === "-" && e.path !== "" && !e.path.includes("*")
      && trackedAtBase(e.path))
  );
  return real ? "satisfies" : "marked-only";
}

/**
 * The specs a branch names: each in `corpus` that the branch changes, or
 * whose file name a commit message on it mentions. One rule for the scope
 * report (plan-scope) and the plan-review gate, which the spec says use
 * the same one; a name matches a spec at any depth of the corpus.
 */
export function namedSpecs(changed, corpus, messages) {
  const mentioned = new Set([...messages.matchAll(/[A-Za-z0-9_.-]+\.spec\.md/g)].map((m) => m[0]));
  const changes = new Set(changed);
  return corpus.filter((s) => changes.has(s) || mentioned.has(s.slice(s.lastIndexOf("/") + 1)));
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
  // A slash anywhere, so a single-segment directory (`optimizer/`) is a
  // token too; the filters below still decide what counts.
  const token = bare ? /`([^`\s]+)`/g : /`([^`\s]*\/[^`\s]*)`/g;
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
