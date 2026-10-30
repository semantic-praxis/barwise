/**
 * An ADR's `Enforced-by:` header and its decision ids, read one way for
 * every caller (docs/specs/executable-adrs.spec.md). `check:architecture`
 * checks the declarations, `check:adr-tests` (WS2) checks the tests, and
 * the generated index (WS4) renders them; one reader keeps the three from
 * disagreeing about what an entry says.
 *
 * Nothing here throws on a malformed ADR. A problem comes back as data,
 * because the index renders outside the check's refusal handling and in
 * `regen:architecture`, where a throw would crash a writer over a typo the
 * check exists to report.
 */
import { header, headerBlock } from "./spec-reader.mjs";

/**
 * A tag in a test's own title: `[adr:<adr-name>#<decision-id>]`. Global,
 * and read with `tagsIn()`, so a title carrying two tags credits both
 * (barwise-ym8.7jz, item 3).
 */
export const TAG = /\[adr:([a-z0-9]+(?:-[a-z0-9]+)*)#([a-z0-9]+(?:-[a-z0-9]+)*)\]/g;

/** Every tag in a title, as `{ adr, id }`. */
export function tagsIn(title) {
  return [...title.matchAll(TAG)].map((m) => ({ adr: m[1], id: m[2] }));
}

/**
 * npm scripts that are gates without the `check:`/`audit:` name, each with
 * the reason it may be declared. The list grows only by a reviewed edit, in
 * the PR that declares a decision such a gate enforces.
 */
export const GATE_EXCEPTIONS = {
  purity: "scans core's source for clocks, network and randomness (determinism-in-core)",
  depcruise: "its rules file is the package graph it enforces against real imports",
};

/**
 * Gates that check other gates. Each would vouch for any decision, so it
 * may be declared only by the ADRs it implements: `check:adr-tests` by
 * none, `check:architecture` by `package-graph-authority`.
 */
export const META_GATES = {
  "check:adr-tests": [],
  "check:architecture": ["package-graph-authority"],
};

/** Whether a script's name lets it be declared as a gate at all. */
export function gateName(script) {
  return /^(check|audit):/.test(script) || Object.hasOwn(GATE_EXCEPTIONS, script);
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISSUE = /^barwise-[a-z0-9]+(?:\.[a-z0-9]+)*$/;

/**
 * Split a header value at commas outside parentheses. A newline is a
 * space: entries contain spaces, and a wrapped header must not split one.
 * Returns `{ parts, problem }`; `problem` names an unbalanced parenthesis.
 */
export function splitEntries(value) {
  const text = value.replace(/\s*\n\s*/g, " ");
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth < 0) return { parts: [], problem: `an unmatched ")" at "${text.slice(0, i + 1)}"` };
    } else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (depth !== 0) return { parts: [], problem: `an unclosed "(" in "${text}"` };
  parts.push(text.slice(start).trim());
  return { parts: parts.filter((p) => p !== ""), problem: null };
}

/** A comma-separated id list, or null when any member is not an id. */
function idList(text) {
  const ids = text.split(",").map((s) => s.trim());
  return ids.length > 0 && ids.every((id) => ID.test(id)) ? ids : null;
}

/**
 * One entry, as `{ kind, ids, ... }` or `{ problem }`. The forms:
 *
 *   npm run <script> (<ids>)
 *   npm run <script> -- <args> (<ids>)
 *   tests (<ids>)
 *   none (<issue-id>: <ids>)
 *
 * Every entry matches its form exactly; a token left over is a problem,
 * so a dropped comma between two entries cannot hide the second.
 */
export function parseEntry(text) {
  let m = /^npm run (\S+)(?: -- (.+?))? \(([^()]*)\)$/.exec(text);
  if (m) {
    const ids = idList(m[3]);
    if (ids === null) return { problem: `"${text}": "${m[3]}" is not a list of decision ids` };
    return { kind: "npm", script: m[1], args: m[2] ?? null, ids, text };
  }
  m = /^tests \(([^()]*)\)$/.exec(text);
  if (m) {
    const ids = idList(m[1]);
    if (ids === null) return { problem: `"${text}": "${m[1]}" is not a list of decision ids` };
    return { kind: "tests", ids, text };
  }
  m = /^none \(([^():]+): ([^()]*)\)$/.exec(text);
  if (m) {
    if (!ISSUE.test(m[1])) return { problem: `"${text}": "${m[1]}" is not an issue id` };
    const ids = idList(m[2]);
    if (ids === null) return { problem: `"${text}": "${m[2]}" is not a list of decision ids` };
    return { kind: "none", issue: m[1], ids, text };
  }
  return {
    problem: `"${text}" is not an entry (npm run <script> (<ids>), tests (<ids>),`
      + ` or none (<issue-id>: <ids>))`,
  };
}

/**
 * The `Enforced-by:` header: `{ present, entries, problems }`. Read through
 * `header()` like every other field; that is safe because every entry starts
 * lowercase and `header()` stops only at a line starting with an uppercase
 * `Word:` (barwise-ym8.7jz, item 9). The field must be the last in the
 * header block, so nothing after it can be mistaken for a continuation.
 */
export function parseEnforcedBy(text) {
  const value = header(text, "Enforced-by");
  if (value === undefined) return { present: false, entries: [], problems: [] };
  const problems = [];
  // The same field-line test header() ends a value at, so the two readers
  // agree on what follows the field.
  const fields = [...headerBlock(text).matchAll(/^([A-Z][A-Za-z-]*):(?:[ \t]|$)/gm)].map((m) =>
    m[1]
  );
  if (fields.at(-1) !== "Enforced-by") {
    problems.push(`Enforced-by: is not the last header field (${fields.at(-1)} follows it)`);
  }
  const { parts, problem } = splitEntries(value);
  if (problem !== null) problems.push(`Enforced-by: ${problem}`);
  const entries = [];
  for (const part of parts) {
    const entry = parseEntry(part);
    if (entry.problem) problems.push(`Enforced-by: ${entry.problem}`);
    else entries.push(entry);
  }
  if (parts.length === 0 && problem === null) problems.push("Enforced-by: declares nothing");
  return { present: true, entries, problems };
}

/**
 * The numbered decisions of an ADR's `## Decision` section, as
 * `{ decisions: [{ n, id, line }], problems }`. A decision's id is `{#id}`
 * directly after the closing `**` of its bold title, which may wrap onto a
 * later line; `id` is null where there is none.
 */
export function decisionIds(text) {
  const lines = text.split("\n");
  const decisions = [];
  const problems = [];
  let inDecision = false;
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^## Decision\s*$/.test(line)) {
      inDecision = true;
      continue;
    }
    if (/^## /.test(line)) inDecision = false;
    if (!inDecision) continue;
    // A numbered line inside a fenced block is an example, not a decision.
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    const item = /^(\d+)\. (.*)$/.exec(line);
    if (!item) continue;
    const n = Number(item[1]);
    if (!item[2].startsWith("**")) {
      decisions.push({ n, id: null, malformed: false, line: i + 1 });
      problems.push(`decision ${n} (line ${i + 1}) has no bold title for an id to follow`);
      continue;
    }
    // The title closes within the item's first lines; read on until it does.
    let rest = item[2].slice(2);
    let j = i;
    while (!rest.includes("**") && j + 1 < lines.length && j < i + 5) {
      j++;
      rest += ` ${lines[j].trim()}`;
    }
    const close = rest.indexOf("**");
    const after = close < 0 ? "" : rest.slice(close + 2);
    const id = /^\s*\{#([^}]*)\}/.exec(after);
    if (close < 0) problems.push(`decision ${n} (line ${i + 1}): its bold title does not close`);
    else if (id && !ID.test(id[1])) {
      problems.push(`decision ${n} (line ${i + 1}): {#${id[1]}} is not a kebab-case id`);
    }
    // A malformed id is reported once, above; `malformed` keeps the caller
    // from reporting the same decision again as having no id.
    decisions.push({
      n,
      id: id && ID.test(id[1]) ? id[1] : null,
      malformed: Boolean(id) && !ID.test(id[1]),
      line: i + 1,
    });
  }
  return { decisions, problems };
}
