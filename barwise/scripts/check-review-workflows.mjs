#!/usr/bin/env node
// Review-workflow gate -- docs/specs/adr-batch10-enforcers.spec.md, WS1.
//
// Four named rules over the files that carry review-policy.md's decisions,
// in one pass, as check-source-sites does for its two. It is an uncached
// script rather than a package's vitest because its inputs (every workflow,
// every script, REVIEW.md, the tracker) cross every package's turbo key.
// Each rule is named, and the ADR names this gate for its own decisions:
//
// - `review-md-owns-lanes` (#review-md-owns-lanes): REVIEW.md's lane table
//   and barwise/review-lanes.json name the same lanes; every lane's source
//   exists; every workflow file is a lane's source or a declared non-lane;
//   and the CI row's When cell equals the phrases derived from ci.yml's
//   `on:` block. Other lanes' triggers are NOT compared with `on:`: the
//   Copilot workflow lists `pull_request_target` while its job runs only on
//   dispatch, so `on:` alone would pass a lane the job does not serve.
// - `copilot-requested` (#copilot-requested): the Copilot workflow's
//   `request` job must admit a non-draft pull request, or the file must
//   carry a `PAUSED <date>` note, directly above the job's `if:`, that names
//   a tracker issue which exists and is open. Closing the issue while the
//   job stays dispatch-only is the failure the ADR's gap describes: a
//   decision not carried out, with tagged tests that pass because they run
//   the job's shell and never ask whether the job starts.
// - `copilot-never-blocks` (#copilot-never-blocks): nothing in the tree
//   waits on Copilot -- no other workflow mentions it, none triggers on it
//   with `workflow_run`, no non-test script names it. What it cannot hold is
//   a required status or ruleset in repository settings, which a session
//   cannot read. It does not say the Copilot job "cannot fail a run": the job
//   fails by design when a request does not land, and copilot-requested
//   relies on that.
// - `tier-informs` (#tier-informs): the review tier has only the readers
//   declared in review-lanes.json. A reader is found by code, not by text:
//   in a script, an import, export-from, require or dynamic import of the
//   tier module, or a string literal naming the table or the classifier
//   (comments are trivia the scanner skips); in a workflow, a step's `run:`
//   or `with:` value (comments dropped by the YAML parse); in a package.json
//   script, its value. It holds "nothing else keys on the tier". It does not
//   hold "author and reviewer run every group", which nothing records.
//
// What this cannot see: a regex literal naming Copilot in a script (the only
// one today matches the path of Copilot's instruction file), a reader that
// builds its path from pieces, and a CI line that is only a shell comment.
//
// Exit 0 no findings, 1 findings, 2 could not answer (git failed, a listed
// input would not read or parse, review-lanes.json is malformed, no workflow,
// script or table row was read, or an `if:` uses a construct the evaluator
// does not know).
//
// Usage: node barwise/scripts/check-review-workflows.mjs

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { noteUntrackedInput, REPO_ROOT, trackedFiles } from "./lib/tracked.mjs";

const ts = createRequire(import.meta.url)("typescript");

export const LANES_FILE = "barwise/review-lanes.json";
export const REVIEW_FILE = "REVIEW.md";
export const TRACKER_FILE = ".beads/issues.jsonl";
export const COPILOT_WORKFLOW = ".github/workflows/copilot-review.yml";
export const CI_WORKFLOW = ".github/workflows/ci.yml";
const PACKAGE_FILES = ["package.json", "barwise/package.json"];
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const SCRIPT = /^barwise\/scripts\/.+\.[cm]js$/;
const TESTS_DIR = /\/tests\//;
/**
 * This file names Copilot because it is the rule that forbids naming it. It
 * is the one script the copilot-never-blocks scan skips, by path, so the
 * exemption is one line a reviewer sees rather than a pattern that widens.
 */
const SELF = "barwise/scripts/check-review-workflows.mjs";

/** The third result: the question could not be asked. */
export class Refusal extends Error {}

const refuse = (message) => {
  throw new Refusal(message);
};

// --- review-md-owns-lanes ---

/** Case, backticks and runs of space do not make two names differ. */
const norm = (s) => s.replace(/`/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The rows of the table under "## Which review runs when": the first cell
 * of each (the lane) and its When cell. Refuses on a missing heading, table
 * or column, because "no rows" would read as "every declared lane is
 * missing" -- a confident wrong answer from a table it never found.
 */
export function laneTable(md) {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => /^## Which review runs when\b/.test(l));
  if (start === -1) refuse(`${REVIEW_FILE} has no '## Which review runs when' heading.`);
  const table = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (line.trim().startsWith("|")) table.push(line);
    else if (table.length > 0) break;
  }
  if (table.length < 3) refuse(`${REVIEW_FILE} has no lane table under its heading.`);
  const cells = (line) =>
    line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const header = cells(table[0]).map(norm);
  const laneCol = header.indexOf("lane");
  const whenCol = header.indexOf("when");
  if (laneCol === -1 || whenCol === -1) {
    refuse(`${REVIEW_FILE}'s lane table needs 'Lane' and 'When' columns.`);
  }
  return table.slice(2).map((line) => {
    const row = cells(line);
    return { lane: row[laneCol] ?? "", when: row[whenCol] ?? "" };
  });
}

/**
 * What a workflow's `on:` block says, as the phrases REVIEW.md's When cell
 * is compared with. A branch filter is part of the phrase (dropping it is a
 * finding); `types:`, `paths:` and the rest are not, since they refine when
 * a run starts and not which events start one.
 */
export function onPhrases(on) {
  let events;
  if (typeof on === "string") events = { [on]: null };
  else if (Array.isArray(on)) events = Object.fromEntries(on.map((e) => [e, null]));
  else if (on && typeof on === "object") events = on;
  else return [];
  const preposition = { push: "to", pull_request: "into" };
  const noun = { push: "Push", pull_request: "Pull request" };
  return Object.entries(events).map(([event, config]) => {
    const base = noun[event] ?? event.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
    if (!(event in preposition)) return base;
    const branches = config?.branches;
    const ignored = config?.["branches-ignore"];
    let phrase = `${base} ${preposition[event]} ${
      Array.isArray(branches) ? branches.join(", ") : "any branch"
    }`;
    if (Array.isArray(ignored)) phrase += ` except ${ignored.join(", ")}`;
    return phrase;
  });
}

function laneFindings({ lanes, reviewMd, workflows, tracked }) {
  const out = [];
  const rows = laneTable(reviewMd);
  const rowNames = rows.map((r) => norm(r.lane));
  const declared = lanes.lanes.map((l) => norm(l.name));

  for (const [i, name] of declared.entries()) {
    if (declared.indexOf(name) !== i) out.push(`lane "${lanes.lanes[i].name}" is declared twice.`);
    if (!rowNames.includes(name)) {
      out.push(
        `lane "${
          lanes.lanes[i].name
        }" is declared in ${LANES_FILE} and has no row in ${REVIEW_FILE}'s table.`,
      );
    }
  }
  for (const [i, name] of rowNames.entries()) {
    if (rowNames.indexOf(name) !== i) {
      out.push(`${REVIEW_FILE}'s table names "${rows[i].lane}" twice.`);
    }
    if (!declared.includes(name)) {
      out.push(
        `${REVIEW_FILE}'s table row "${rows[i].lane}" is not a lane declared in ${LANES_FILE}.`,
      );
    }
  }

  const trackedSet = new Set(tracked);
  const exists = (path) => trackedSet.has(path) || tracked.some((f) => f.startsWith(`${path}/`));
  for (const lane of lanes.lanes) {
    if (lane.source !== "external" && !exists(lane.source)) {
      out.push(`lane "${lane.name}": source ${lane.source} is not a tracked file or directory.`);
    }
  }

  const sources = new Set(lanes.lanes.map((l) => l.source));
  const nonLanes = new Set(lanes.nonLaneWorkflows.map((w) => w.file));
  for (const w of workflows) {
    if (!sources.has(w.file) && !nonLanes.has(w.file)) {
      out.push(
        `${w.file} is neither a declared lane's source nor a declared non-lane in ${LANES_FILE}; `
          + "a review workflow cannot appear unrecorded.",
      );
    }
  }
  for (const file of nonLanes) {
    if (!workflows.some((w) => w.file === file)) {
      out.push(
        `${LANES_FILE} declares non-lane workflow ${file}, which is not a tracked workflow (stale row).`,
      );
    }
    if (sources.has(file)) {
      out.push(`${file} is declared both as a lane's source and as a non-lane.`);
    }
  }

  for (const lane of lanes.lanes.filter((l) => l.whenFrom === "on")) {
    const workflow = workflows.find((w) => w.file === lane.source);
    const row = rows.find((r) => norm(r.lane) === norm(lane.name));
    if (!workflow || !row) continue; // reported above
    const expected = onPhrases(workflow.doc?.on).join("; ");
    if (norm(row.when) !== norm(expected)) {
      out.push(
        `lane "${lane.name}": When cell reads "${row.when}" but ${lane.source}'s on: block says "${expected}".`,
      );
    }
  }
  return out;
}

// --- copilot-requested ---

class Unsupported extends Error {}

/**
 * Whether an `if:` expression is true for a non-draft pull_request_target
 * event. A small evaluator rather than a pattern, because the intended
 * condition is `dispatch || draft == false`, which admits a pull request
 * without naming one. It knows `&&`, `||`, `!`, `==`, `!=`, parentheses,
 * quoted strings, true/false/null and two context values; anything else
 * (a function call, another context) is Unsupported, which the gate turns
 * into a refusal -- the condition could not be read, so it is not "false".
 */
export function ifAdmitsPullRequest(condition) {
  if (condition === undefined || condition === true) return true;
  if (condition === false) return false;
  if (typeof condition !== "string") throw new Unsupported(`an if: of type ${typeof condition}`);
  const context = {
    "github.event_name": "pull_request_target",
    "github.event.pull_request.draft": false,
  };
  const src = condition.trim().replace(/^\$\{\{([\s\S]*)\}\}$/, "$1");
  const tokens = [];
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (["&&", "||", "==", "!="].includes(src.slice(i, i + 2))) {
      tokens.push(src.slice(i, i + 2));
      i += 2;
    } else if ("()!,".includes(c)) {
      tokens.push(c);
      i++;
    } else if (c === "'") {
      let j = i + 1;
      let text = "";
      for (; j < src.length; j++) {
        if (src[j] === "'" && src[j + 1] === "'") {
          text += "'";
          j++;
        } else if (src[j] === "'") break;
        else text += src[j];
      }
      if (j >= src.length) throw new Unsupported("an unterminated string");
      tokens.push({ value: text });
      i = j + 1;
    } else {
      const m = /^[A-Za-z_][\w.-]*/.exec(src.slice(i));
      if (!m) throw new Unsupported(`the character '${c}'`);
      tokens.push({ id: m[0] });
      i += m[0].length;
    }
  }
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (t) => (peek() === t ? (pos++, true) : false);
  const lower = (v) => (typeof v === "string" ? v.toLowerCase() : v);
  const equal = (a, b) => {
    if (typeof a !== typeof b && a !== null && b !== null) {
      throw new Unsupported("a comparison between a string and a boolean");
    }
    return lower(a) === lower(b);
  };
  const primary = () => {
    const t = tokens[pos++];
    if (t === "(") {
      const v = or();
      if (!eat(")")) throw new Unsupported("an unbalanced parenthesis");
      return v;
    }
    if (t === "!") return !truthy(primary());
    if (t && typeof t === "object" && "value" in t) return t.value;
    if (t && typeof t === "object" && "id" in t) {
      if (peek() === "(") throw new Unsupported(`the function ${t.id}()`);
      if (t.id === "true") return true;
      if (t.id === "false") return false;
      if (t.id === "null") return null;
      if (Object.hasOwn(context, t.id)) return context[t.id];
      throw new Unsupported(`the context value ${t.id}`);
    }
    throw new Unsupported("an incomplete expression");
  };
  const truthy = (v) => !(v === false || v === null || v === "" || v === 0);
  const eq = () => {
    let left = primary();
    while (peek() === "==" || peek() === "!=") {
      const op = tokens[pos++];
      const right = primary();
      left = op === "==" ? equal(left, right) : !equal(left, right);
    }
    return left;
  };
  const and = () => {
    let left = eq();
    while (eat("&&")) {
      const right = eq();
      left = truthy(left) ? right : left;
    }
    return left;
  };
  const or = () => {
    let left = and();
    while (eat("||")) {
      const right = and();
      left = truthy(left) ? left : right;
    }
    return left;
  };
  const value = or();
  if (pos !== tokens.length) throw new Unsupported("trailing tokens");
  return truthy(value);
}

const ISSUE_ID = /barwise-[a-z0-9]+(?:\.[a-z0-9]+)*/g;
const PAUSED = /PAUSED \d{4}-\d{2}-\d{2}\b/;

/**
 * Runs of consecutive `#` comment lines, split at a bare `#` line, so a
 * header's later paragraphs (which cite other issues) are not the pause note.
 */
function commentParagraphs(text) {
  const paragraphs = [];
  let current = null;
  for (const [i, line] of text.split("\n").entries()) {
    if (line.trim() === "#") {
      current = null;
    } else if (line.trim().startsWith("#")) {
      if (!current) paragraphs.push(current = { line: i, text: "" });
      current.text += `${line}\n`;
    } else {
      current = null;
    }
  }
  return paragraphs;
}

/** The comment lines directly above the `request` job's `if:` line. */
function noteAboveJobIf(text) {
  const lines = text.split("\n");
  const job = lines.findIndex((l) => /^ {2}request:\s*$/.test(l));
  if (job === -1) return "";
  let at = -1;
  for (let i = job + 1; i < lines.length && !/^ {2}\S/.test(lines[i]); i++) {
    if (/^ {4}if:/.test(lines[i])) {
      at = i;
      break;
    }
  }
  if (at === -1) return "";
  const note = [];
  for (let i = at - 1; i > job && lines[i].trim().startsWith("#"); i--) note.unshift(lines[i]);
  return note.join("\n");
}

function copilotRequestedFindings({ workflows, issues }) {
  const w = workflows.find((x) => x.file === COPILOT_WORKFLOW);
  if (!w) return [`${COPILOT_WORKFLOW} is not a tracked workflow.`];
  const job = w.doc?.jobs?.request;
  if (!job) return [`${COPILOT_WORKFLOW} has no 'request' job.`];
  const events = w.doc.on && typeof w.doc.on === "object" ? Object.keys(w.doc.on) : [w.doc.on];
  let admits;
  try {
    admits = ifAdmitsPullRequest(job.if) && events.includes("pull_request_target");
  } catch (error) {
    if (error instanceof Unsupported) {
      refuse(
        `${COPILOT_WORKFLOW}: the request job's if: uses ${error.message}, which this gate cannot evaluate.`,
      );
    }
    throw error;
  }
  const paused = commentParagraphs(w.text).filter((p) => PAUSED.test(p.text));
  const ids = [...new Set(paused.flatMap((p) => p.text.match(ISSUE_ID) ?? []))];
  if (admits) {
    return paused.length === 0 ? [] : [
      `${COPILOT_WORKFLOW} carries a PAUSED note but the request job admits pull requests; `
      + "delete the declaration (review-policy#copilot-requested).",
    ];
  }
  const out = [];
  if (!PAUSED.test(noteAboveJobIf(w.text))) {
    out.push(
      `${COPILOT_WORKFLOW}: the request job does not run on pull requests and the comment directly above its if: `
        + "has no 'PAUSED <date>' note. Restore the condition, or declare the pause "
        + "(review-policy#copilot-requested).",
    );
  }
  if (ids.length === 0) {
    out.push(`${COPILOT_WORKFLOW}: the PAUSED note names no tracker issue (barwise-...).`);
  }
  for (const id of ids) {
    const status = issues.get(id);
    if (status === undefined) {
      out.push(
        `${COPILOT_WORKFLOW}: the PAUSED note names ${id}, which is not in ${TRACKER_FILE}.`,
      );
    } else if (status === "closed") {
      out.push(
        `${COPILOT_WORKFLOW}: the PAUSED note names ${id}, which is closed, and the job still does not run on `
          + "pull requests. Restore the condition and delete the note.",
      );
    }
  }
  return out;
}

// --- copilot-never-blocks ---

/** Every string in a parsed document, key or value, with where it is. */
function* strings(node, path = "") {
  if (typeof node === "string") yield { path, text: node };
  else if (Array.isArray(node)) {
    for (const [i, v] of node.entries()) yield* strings(v, `${path}[${i}]`);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      yield { path: path ? `${path}.${k}` : k, text: k };
      yield* strings(v, path ? `${path}.${k}` : k);
    }
  }
}

const SCANNED_KINDS = () =>
  new Set([
    ts.SyntaxKind.Identifier,
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail,
  ]);

function parseScript(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

/** Every identifier or string token of a script whose text satisfies `test`. */
function scriptTokens(file, text, test) {
  const sf = parseScript(file, text);
  const kinds = SCANNED_KINDS();
  const hits = [];
  (function walk(node) {
    if (kinds.has(node.kind)) {
      const t = node.text ?? node.getText(sf);
      if (test(t)) {
        hits.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: t });
      }
    }
    ts.forEachChild(node, walk);
  })(sf);
  return hits;
}

function copilotNeverBlocksFindings({ workflows, scripts }) {
  const out = [];
  const copilot = workflows.find((w) => w.file === COPILOT_WORKFLOW);
  const copilotName = (copilot?.doc?.name ?? "").toLowerCase();
  for (const w of workflows) {
    const run = w.doc?.on && typeof w.doc.on === "object" ? w.doc.on.workflow_run : undefined;
    const named = Array.isArray(run?.workflows) ? run.workflows : [];
    for (const n of named) {
      const s = String(n).toLowerCase();
      if (s.includes("copilot") || (copilotName && s === copilotName)) {
        out.push(
          `${w.file}: triggers on workflow_run of "${n}"; nothing may wait on the Copilot review.`,
        );
      }
    }
    if (w.file === COPILOT_WORKFLOW) continue;
    for (const s of strings(w.doc)) {
      if (s.path.startsWith("on.workflow_run")) continue; // reported above
      if (/copilot/i.test(s.text)) {
        out.push(`${w.file} (${s.path}): mentions Copilot; only ${COPILOT_WORKFLOW} may.`);
      }
    }
  }
  for (const s of scripts.filter((x) => x.file !== SELF)) {
    for (const h of scriptTokens(s.file, s.text, (t) => /copilot/i.test(t))) {
      out.push(
        `${s.file}:${h.line}: names Copilot ("${
          h.text.slice(0, 40)
        }"); no script may read its review state.`,
      );
    }
  }
  return out;
}

// --- tier-informs ---

/** Bindings an ImportDeclaration or ExportDeclaration takes, or "*" if unknowable. */
function importedBindings(node) {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause || clause.name) return ["*"];
    const named = clause.namedBindings;
    if (!named || ts.isNamespaceImport(named)) return ["*"];
    return named.elements.map((e) => (e.propertyName ?? e.name).text);
  }
  if (ts.isExportDeclaration(node)) {
    const named = node.exportClause;
    if (!named || !ts.isNamedExports(named)) return ["*"];
    return named.elements.map((e) => (e.propertyName ?? e.name).text);
  }
  return ["*"];
}

/**
 * Whether a script reads the tier, and with which bindings. A module import
 * contributes its named bindings; every other form (a literal naming the
 * table or the classifier, `require`, a dynamic import) contributes "*",
 * since what it takes cannot be told.
 */
export function scriptTierRead(file, text, tokens) {
  const sf = parseScript(file, text);
  const bindings = new Set();
  let hit = false;
  const visit = (node) => {
    const literal = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
    if (literal) {
      const t = node.text;
      const isModule = t.endsWith(tokens.modulePath);
      if (isModule || t.endsWith(tokens.tablePath) || t.includes(tokens.classifierPath)) {
        hit = true;
        const parent = node.parent;
        const declared = isModule && parent
          && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent));
        for (const b of declared ? importedBindings(parent) : ["*"]) bindings.add(b);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hit ? { bindings: [...bindings] } : null;
}

const SHELL_OUTPUT = /^\s*(echo|printf)\s/;

/**
 * The lines of a workflow step's `run:` and `with:` that read the tier. A
 * shell comment is not a read; a plain `echo` or `printf` message with no
 * command substitution only prints a name, and is not one either.
 */
function workflowTierLines(doc, tokens, packageScripts) {
  const hits = [];
  for (const [jobName, job] of Object.entries(doc?.jobs ?? {})) {
    for (const [i, step] of (job?.steps ?? []).entries()) {
      const values = [step.run, step.with === undefined ? undefined : JSON.stringify(step.with)]
        .filter((v) => typeof v === "string");
      for (const value of values) {
        for (const line of value.split("\n")) {
          const trimmed = line.trim();
          if (trimmed === "" || trimmed.startsWith("#")) continue;
          const direct = tokens.workflowTokens.some((t) => line.includes(t));
          const viaScript = [...line.matchAll(/npm run ([\w:.-]+)/g)].some((m) =>
            tokens.workflowTokens.some((t) => (packageScripts.get(m[1]) ?? "").includes(t))
          );
          if (!direct && !viaScript) continue;
          if (SHELL_OUTPUT.test(line) && !line.includes("$(") && !line.includes("`")) continue;
          hits.push({ where: `${jobName}.steps[${i}]`, line: trimmed });
        }
      }
    }
  }
  return hits;
}

function tierFindings({ lanes, workflows, scripts, packages }) {
  const out = [];
  const tokens = lanes.tierTokens;
  const readers = lanes.tierReaders;
  const key = (r) => (r.kind === "package-script" ? `${r.file}#${r.script}` : r.file);
  const declared = new Map(readers.map((r) => [`${r.kind}:${key(r)}`, r]));
  const seen = new Set();

  const packageScripts = new Map();
  for (const p of [...packages].reverse()) {
    for (const [name, value] of Object.entries(p.scripts)) packageScripts.set(name, value);
  }

  for (const s of scripts) {
    const read = scriptTierRead(s.file, s.text, tokens);
    if (!read) continue;
    const reader = declared.get(`script:${s.file}`);
    seen.add(`script:${s.file}`);
    if (!reader) {
      out.push(
        `${s.file}: reads the review tier and is not a declared reader in ${LANES_FILE} (review-policy#tier-informs).`,
      );
    } else if (reader.bindings !== "any") {
      const extra = read.bindings.filter((b) => !reader.bindings.includes(b));
      if (extra.length > 0) {
        out.push(
          `${s.file}: takes ${extra.join(", ")} from the tier module; it may take only ${
            reader.bindings.join(", ")
          } `
            + "(the rest carry the tier).",
        );
      }
    }
  }

  for (const w of workflows) {
    const lines = workflowTierLines(w.doc, tokens, packageScripts);
    const reader = declared.get(`workflow:${w.file}`);
    if (lines.length > 0) seen.add(`workflow:${w.file}`);
    const used = new Set();
    for (const hit of lines) {
      const command = reader?.commands?.find((c) => hit.line.includes(c));
      if (command) used.add(command);
      else {
        out.push(
          `${w.file} (${hit.where}): "${
            hit.line.slice(0, 80)
          }" reads the review tier and is not a declared `
            + "reader (review-policy#tier-informs).",
        );
      }
    }
    for (const c of reader?.commands ?? []) {
      if (lines.length > 0 && !used.has(c)) {
        out.push(
          `${LANES_FILE}: reader ${w.file} declares "${c}", which no step runs (stale row).`,
        );
      }
    }
    if (w.file === COPILOT_WORKFLOW) out.push(...tierUseInCopilot(w));
  }

  for (const p of packages) {
    for (const [name, value] of Object.entries(p.scripts)) {
      if (!tokens.workflowTokens.some((t) => value.includes(t))) continue;
      seen.add(`package-script:${p.file}#${name}`);
      if (!declared.has(`package-script:${p.file}#${name}`)) {
        out.push(
          `${p.file} script ${name}: reads the review tier and is not a declared reader (review-policy#tier-informs).`,
        );
      }
    }
  }

  for (const [id, r] of declared) {
    if (!seen.has(id)) {
      out.push(
        `${LANES_FILE}: declared tier reader ${r.kind} ${key(r)} reads nothing (stale row).`,
      );
    }
  }
  return out;
}

/** `.tier` may be printed by Copilot's workflow and nothing else (review-policy#tier-informs). */
function tierUseInCopilot(w) {
  const out = [];
  for (const [jobName, job] of Object.entries(w.doc?.jobs ?? {})) {
    if (/\btier\b/.test(String(job?.if ?? ""))) {
      out.push(`${w.file} (${jobName}): a job condition tests the tier.`);
    }
    for (const [i, step] of (job?.steps ?? []).entries()) {
      if (/\btier\b/.test(String(step.if ?? ""))) {
        out.push(`${w.file} (${jobName}.steps[${i}]): a step condition tests the tier.`);
      }
      for (const line of String(step.run ?? "").split("\n")) {
        if (!/\.tier\b/.test(line) || line.trim().startsWith("#")) continue;
        if (!SHELL_OUTPUT.test(line)) {
          out.push(
            `${w.file} (${jobName}.steps[${i}]): ".tier" is used outside an echo or printf: "${
              line.trim().slice(0, 80)
            }".`,
          );
        }
      }
    }
  }
  return out;
}

// --- reading and running ---

/** All four rules over already-read inputs: pure, so a test plants anything. */
export function findings(inputs) {
  return [
    ...laneFindings(inputs).map((f) => `review-md-owns-lanes  ${f}`),
    ...copilotRequestedFindings(inputs).map((f) => `copilot-requested  ${f}`),
    ...copilotNeverBlocksFindings(inputs).map((f) => `copilot-never-blocks  ${f}`),
    ...tierFindings(inputs).map((f) => `tier-informs  ${f}`),
  ];
}

/** Shape-check review-lanes.json: a malformed declaration cannot be judged against. */
export function lanesProblems(lanes) {
  const problems = [];
  const isStr = (v) => typeof v === "string" && v.trim() !== "";
  if (!lanes || typeof lanes !== "object") return ["not an object"];
  if (!Array.isArray(lanes.lanes) || lanes.lanes.length === 0) {
    problems.push("'lanes' is empty or missing");
  }
  for (const l of lanes.lanes ?? []) {
    if (!isStr(l?.name) || !isStr(l?.source)) {
      problems.push(`lane ${JSON.stringify(l)} needs a name and a source`);
    } else if (l.source === "external" && !isStr(l.reason)) {
      problems.push(`external lane "${l.name}" needs a reason`);
    }
  }
  if (!Array.isArray(lanes.nonLaneWorkflows)) problems.push("'nonLaneWorkflows' is missing");
  for (const w of lanes.nonLaneWorkflows ?? []) {
    if (!isStr(w?.file) || !isStr(w?.reason)) {
      problems.push(`non-lane ${JSON.stringify(w)} needs a file and a reason`);
    }
  }
  const t = lanes.tierTokens;
  if (
    !t || !isStr(t.modulePath) || !isStr(t.tablePath) || !isStr(t.classifierPath)
    || !Array.isArray(t.workflowTokens) || t.workflowTokens.length === 0
    || !t.workflowTokens.every(isStr)
  ) {
    problems.push("'tierTokens' needs modulePath, tablePath, classifierPath and workflowTokens");
  }
  if (!Array.isArray(lanes.tierReaders) || lanes.tierReaders.length === 0) {
    problems.push("'tierReaders' is empty or missing");
  }
  for (const r of lanes.tierReaders ?? []) {
    if (!isStr(r?.file) || !isStr(r?.reason)) {
      problems.push(`reader ${JSON.stringify(r)} needs a file and a reason`);
    } else if (r.kind === "script") {
      if (r.bindings !== "any" && !(Array.isArray(r.bindings) && r.bindings.every(isStr))) {
        problems.push(`script reader ${r.file} needs bindings "any" or a list of names`);
      }
    } else if (r.kind === "workflow") {
      if (!Array.isArray(r.commands) || r.commands.length === 0) {
        problems.push(`workflow reader ${r.file} needs commands`);
      }
    } else if (r.kind === "package-script") {
      if (!isStr(r.script)) problems.push(`package-script reader ${r.file} needs a script`);
    } else problems.push(`reader ${r.file} has unknown kind ${JSON.stringify(r.kind)}`);
  }
  return problems;
}

function readText(file) {
  try {
    return readFileSync(resolve(REPO_ROOT, file), "utf8");
  } catch (error) {
    return refuse(`${file} would not read (${String(error.message ?? error)}).`);
  }
}

function readJson(file) {
  try {
    return JSON.parse(readText(file));
  } catch (error) {
    if (error instanceof Refusal) throw error;
    return refuse(`${file} is not valid JSON (${String(error.message ?? error)}).`);
  }
}

/** Everything the rules read, from the working tree, listed by git. */
export function readInputs() {
  const tracked = trackedFiles();
  const workflowFiles = tracked.filter((f) => WORKFLOW.test(f));
  const scriptFiles = tracked.filter((f) => SCRIPT.test(f) && !TESTS_DIR.test(f));
  if (workflowFiles.length === 0) refuse("no tracked workflow under .github/workflows.");
  if (scriptFiles.length === 0) refuse("no tracked script under barwise/scripts.");
  noteUntrackedInput({ pathspec: ".github/workflows", suffix: ".yml", gate: "review workflows" });
  noteUntrackedInput({ pathspec: "barwise/scripts", suffix: ".mjs", gate: "review workflows" });

  const lanes = readJson(LANES_FILE);
  const problems = lanesProblems(lanes);
  if (problems.length > 0) refuse(`${LANES_FILE} is malformed: ${problems.join("; ")}.`);

  const workflows = workflowFiles.map((file) => {
    const text = readText(file);
    try {
      return { file, text, doc: parse(text) };
    } catch (error) {
      return refuse(
        `${file} would not parse as YAML (${String(error.message ?? error).split("\n")[0]}).`,
      );
    }
  });
  const scripts = scriptFiles.map((file) => ({ file, text: readText(file) }));
  const packages = PACKAGE_FILES.map((file) => {
    const json = readJson(file);
    if (!json.scripts || typeof json.scripts !== "object") refuse(`${file} has no scripts.`);
    return { file, scripts: json.scripts };
  });

  const issues = new Map();
  for (const [i, line] of readText(TRACKER_FILE).split("\n").entries()) {
    if (line.trim() === "") continue;
    try {
      const o = JSON.parse(line);
      if (typeof o.id === "string") issues.set(o.id, o.status);
    } catch {
      refuse(`${TRACKER_FILE} line ${i + 1} is not valid JSON.`);
    }
  }
  if (issues.size === 0) refuse(`${TRACKER_FILE} holds no issue.`);

  return { lanes, reviewMd: readText(REVIEW_FILE), workflows, scripts, packages, issues, tracked };
}

function main() {
  let inputs;
  let found;
  try {
    inputs = readInputs();
    found = findings(inputs);
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    process.stderr.write(
      `review workflows: ${error.message}\n  Refusing rather than printing OK over input it did not read.\n`,
    );
    process.exit(2);
  }
  if (found.length === 0) {
    process.stdout.write(
      `review workflows: OK -- ${inputs.workflows.length} workflow(s), ${inputs.lanes.lanes.length} lane(s), `
        + `${inputs.scripts.length} script(s) scanned for tier readers (${inputs.lanes.tierReaders.length} declared).\n`,
    );
    process.exit(0);
  }
  process.stderr.write(`review workflows: ${found.length} finding(s):\n`);
  for (const f of found) process.stderr.write(`  ${f}\n`);
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
