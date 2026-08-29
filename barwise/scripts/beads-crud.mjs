#!/usr/bin/env node
// beads-crud.mjs -- create/read/update/delete issues directly against
// .beads/issues.jsonl, for sessions where the `bd` binary is not
// installed. Spec: docs/specs/beads-issue-crud-scripts.spec.md
//
// Every write is a canonically-formatted JSONL line matching what
// scripts/check-beads.sh --strict accepts (compact separators,
// &/</> escaped, one object per line, trailing newline), with
// dependency_count/dependent_count/comment_count computed rather than
// hand-typed.
//
// Usage:
//   node scripts/beads-crud.mjs create --title "..." [--description "..."]
//     [--type task|bug|feature|epic|chore|decision] [--priority 0-4]
//     [--status open|in_progress|blocked|closed|deferred|hooked|pinned]
//     [--owner EMAIL] [--created-by NAME] [--design PATH]
//     [--parent PARENT_ID] [--depends-on ID[:TYPE]] [--acceptance-criteria "..."]
//   node scripts/beads-crud.mjs show <id>
//   node scripts/beads-crud.mjs list [--status s] [--type t] [--priority p]
//   node scripts/beads-crud.mjs update <id> [--title ...] [--description ...]
//     [--status ...] [--priority N] [--type ...] [--owner ...] [--design ...]
//     [--acceptance-criteria ...] [--notes ...] [--depends-on ID[:TYPE]]
//   node scripts/beads-crud.mjs close <id> [--reason "..."]
//   node scripts/beads-crud.mjs delete <id> [--force]

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BLOCKS_TYPE = "blocks";
const STATUS = new Set([
  "open",
  "in_progress",
  "blocked",
  "closed",
  "deferred",
  "hooked",
  "pinned",
]);
const ITYPE = new Set(["feature", "bug", "task", "epic", "chore", "decision"]);
const DEPTYPE = new Set([
  "blocks",
  "blocked-by",
  "related",
  "parent-child",
  "discovered-from",
  "conditional-blocks",
  "waits-for",
]);

function gitRoot() {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

function issuesPath() {
  return join(gitRoot(), ".beads", "issues.jsonl");
}

// Mirrors check-beads.sh's go_compact(): reproduce cmd/bd/export.go's
// json.Marshal output so every write passes the canonical-form check.
function canonicalLine(obj) {
  const json = JSON.stringify(obj)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
  return json;
}

function readAll() {
  const path = issuesPath();
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n");
  const trailingNewline = raw.endsWith("\n");
  const records = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    records.push({ obj: JSON.parse(line), lineNo: i + 1 });
  }
  return { path, records, trailingNewline };
}

function writeAll(path, records) {
  const body = records.map((r) => canonicalLine(r.obj)).join("\n") + "\n";
  writeFileSync(path, body, "utf8");
}

function now() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function fail(message) {
  console.error(`beads-crud: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function blocksDepCount(id, records) {
  const self = records.find((r) => r.obj.id === id);
  const dependencyCount = self
    ? (self.obj.dependencies || []).filter((d) => d.type === BLOCKS_TYPE).length
    : 0;
  let dependentCount = 0;
  for (const r of records) {
    for (const d of r.obj.dependencies || []) {
      if (d.type === BLOCKS_TYPE && d.depends_on_id === id) dependentCount++;
    }
  }
  return { dependencyCount, dependentCount };
}

// Recompute dependency_count/dependent_count for `id` and for every
// issue referenced by its dependency edges (a dependent_count change
// on the other side of an edge we just added/removed).
function recomputeCounts(records, ids) {
  const touched = new Set(ids);
  for (const r of records) {
    if (touched.has(r.obj.id)) {
      const { dependencyCount, dependentCount } = blocksDepCount(r.obj.id, records);
      r.obj.dependency_count = dependencyCount;
      r.obj.dependent_count = dependentCount;
    }
  }
}

function nextTopLevelId(records, prefix) {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const r of records) {
    const m = re.exec(r.obj.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${max + 1}`;
}

function nextChildId(records, parentId) {
  let max = 0;
  const re = new RegExp(`^${parentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(\\d+)$`);
  for (const r of records) {
    const m = re.exec(r.obj.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${parentId}.${max + 1}`;
}

function findOrFail(records, id) {
  const r = records.find((x) => x.obj.id === id);
  if (!r) fail(`no such issue: ${id}`);
  return r;
}

function parseDependsOn(spec) {
  const [id, type] = spec.split(":");
  const depType = type || "related";
  if (!DEPTYPE.has(depType)) fail(`unknown dependency type: ${depType} (spec: ${spec})`);
  return { id, type: depType };
}

function cmdCreate(flags) {
  const { path, records } = readAll();
  if (!flags.title) fail("create requires --title");

  const status = flags.status || "open";
  if (!STATUS.has(status)) fail(`unknown status: ${status}`);
  const issueType = flags.type || "task";
  if (!ITYPE.has(issueType)) fail(`unknown issue_type: ${issueType}`);
  const priority = flags.priority !== undefined ? Number(flags.priority) : 2;
  if (!Number.isInteger(priority) || priority < 0 || priority > 4) {
    fail(`priority must be an integer 0..4`);
  }

  const prefix = flags.prefix || "barwise";
  const id = flags.parent ? nextChildId(records, flags.parent) : nextTopLevelId(records, prefix);
  if (flags.parent) findOrFail(records, flags.parent);

  const ts = now();
  const owner = flags.owner || "noreply@anthropic.com";
  const createdBy = flags["created-by"] || "claude";

  const obj = {
    _type: "issue",
    id,
    title: flags.title,
    ...(flags.description ? { description: flags.description } : {}),
    ...(flags["acceptance-criteria"] ? { acceptance_criteria: flags["acceptance-criteria"] } : {}),
    status,
    priority,
    issue_type: issueType,
    owner,
    created_at: ts,
    created_by: createdBy,
    updated_at: ts,
    ...(flags.design ? { design: flags.design } : {}),
    // The usage string at the top of this file has advertised --notes on
    // `create` since it was written; nothing implemented it, so the flag
    // parsed, the issue wrote, and the notes vanished. Documented and
    // unimplemented is the worst of the three states.
    ...(flags.notes ? { notes: flags.notes } : {}),
    ...(flags.labels ? { labels: splitList(flags.labels) } : {}),
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
  };

  const dependencies = [];
  if (flags.parent) {
    dependencies.push({
      issue_id: id,
      depends_on_id: flags.parent,
      type: "parent-child",
      created_at: ts,
      created_by: createdBy,
      metadata: "{}",
    });
  }
  if (flags["depends-on"]) {
    const { id: dependsOnId, type } = parseDependsOn(flags["depends-on"]);
    findOrFail(records, dependsOnId);
    dependencies.push({
      issue_id: id,
      depends_on_id: dependsOnId,
      type,
      created_at: ts,
      created_by: createdBy,
      metadata: "{}",
    });
  }
  if (dependencies.length > 0) obj.dependencies = dependencies;

  records.push({ obj });
  recomputeCounts(records, [id, ...dependencies.map((d) => d.depends_on_id)]);
  writeAll(path, records);
  console.log(id);
}

function cmdShow(positional) {
  const [id] = positional;
  if (!id) fail("show requires <id>");
  const { records } = readAll();
  const r = findOrFail(records, id);
  console.log(JSON.stringify(r.obj, null, 2));
}

function cmdList(flags) {
  const { records } = readAll();
  let rows = records.map((r) => r.obj);
  if (flags.status) rows = rows.filter((o) => o.status === flags.status);
  if (flags.type) rows = rows.filter((o) => o.issue_type === flags.type);
  if (flags.priority !== undefined) {
    rows = rows.filter((o) => o.priority === Number(flags.priority));
  }
  // The query that makes a recurring finding visible: process failures
  // are filed with `--labels process`, and a session review starts by
  // reading them back. Without a filter they are 200 rows down.
  if (flags.label) rows = rows.filter((o) => (o.labels || []).includes(flags.label));
  for (const o of rows) {
    console.log(`${o.id}\t${o.status}\tp${o.priority}\t${o.issue_type}\t${o.title}`);
  }
  console.error(`${rows.length} issue(s)`);
}

const UPDATABLE_FIELDS = {
  title: "title",
  description: "description",
  status: "status",
  priority: "priority",
  type: "issue_type",
  owner: "owner",
  design: "design",
  "acceptance-criteria": "acceptance_criteria",
  notes: "notes",
  assignee: "assignee",
  labels: "labels",
};

/** Fields stored as an array, given on the command line comma-separated. */
const LIST_FIELDS = new Set(["labels"]);

/** `--labels a,b, c` -> ["a","b","c"]. Empty entries dropped. */
function splitList(value) {
  if (value === true) fail("--labels needs a comma-separated value");
  return String(value).split(",").map((x) => x.trim()).filter(Boolean);
}

function cmdUpdate(positional, flags) {
  const [id] = positional;
  if (!id) fail("update requires <id>");
  const { path, records } = readAll();
  const r = findOrFail(records, id);

  let changed = false;
  for (const [flag, field] of Object.entries(UPDATABLE_FIELDS)) {
    if (flags[flag] === undefined) continue;
    let value = flags[flag];
    if (field === "priority") {
      value = Number(value);
      if (!Number.isInteger(value) || value < 0 || value > 4) {
        fail(`priority must be an integer 0..4`);
      }
    }
    if (field === "status" && !STATUS.has(value)) fail(`unknown status: ${value}`);
    if (field === "issue_type" && !ITYPE.has(value)) fail(`unknown issue_type: ${value}`);
    if (LIST_FIELDS.has(field)) value = splitList(value);
    r.obj[field] = value;
    changed = true;
  }

  const touchedIds = [id];
  if (flags["depends-on"]) {
    const { id: dependsOnId, type } = parseDependsOn(flags["depends-on"]);
    findOrFail(records, dependsOnId);
    r.obj.dependencies = r.obj.dependencies || [];
    r.obj.dependencies.push({
      issue_id: id,
      depends_on_id: dependsOnId,
      type,
      created_at: now(),
      created_by: flags["created-by"] || "claude",
      metadata: "{}",
    });
    touchedIds.push(dependsOnId);
    changed = true;
  }

  if (!changed) fail("update requires at least one field flag or --depends-on");

  r.obj.updated_at = now();
  recomputeCounts(records, touchedIds);
  writeAll(path, records);
  console.log(id);
}

function cmdClose(positional, flags) {
  const [id] = positional;
  if (!id) fail("close requires <id>");
  const { path, records } = readAll();
  const r = findOrFail(records, id);
  const ts = now();
  r.obj.status = "closed";
  r.obj.closed_at = ts;
  r.obj.updated_at = ts;
  if (flags.reason) r.obj.close_reason = flags.reason;
  writeAll(path, records);
  console.log(id);
}

function cmdDelete(positional, flags) {
  const [id] = positional;
  if (!id) fail("delete requires <id>");
  const { path, records } = readAll();
  findOrFail(records, id);
  const { dependentCount } = blocksDepCount(id, records);
  if (dependentCount > 0 && !flags.force) {
    fail(`${id} has ${dependentCount} blocks-dependent issue(s); pass --force to delete anyway`);
  }
  const kept = records.filter((r) => r.obj.id !== id);
  for (const r of kept) {
    if (r.obj.dependencies) {
      const filtered = r.obj.dependencies.filter((d) => d.depends_on_id !== id);
      if (filtered.length > 0) r.obj.dependencies = filtered;
      else delete r.obj.dependencies;
    }
  }
  recomputeCounts(kept, kept.map((r) => r.obj.id));
  writeAll(path, kept);
  console.log(id);
}

/**
 * What each subcommand actually reads. An unlisted flag is REFUSED, not
 * ignored -- because ignoring it is how this tool has twice reported
 * success while dropping the caller's data on the floor: once for
 * `update --append-description` (never a field) and once for `create
 * --notes` (an update-only field). Both times the write "succeeded",
 * both times the content was gone, and both times it was caught only by
 * reading the issue back afterwards. A caller cannot be asked to
 * remember which fields each verb happens to support; the tool knows,
 * so the tool says.
 */
const ACCEPTED_FLAGS = {
  create: [
    "title",
    "status",
    "type",
    "priority",
    "prefix",
    "parent",
    "owner",
    "created-by",
    "description",
    "design",
    "acceptance-criteria",
    "notes",
    "labels",
    "depends-on",
  ],
  show: [],
  list: ["status", "type", "priority", "label"],
  // Not just UPDATABLE_FIELDS: cmdUpdate also reads --depends-on and
  // --created-by, and deriving the list from the field map alone would
  // have refused them -- turning a silent drop into a hard refusal of
  // something that worked. The allowlist has to match what the function
  // reads, not what one table in it happens to hold.
  update: [...Object.keys(UPDATABLE_FIELDS), "depends-on", "created-by"],
  close: ["reason"],
  delete: ["force"],
};

function rejectUnknownFlags(cmd, flags) {
  const accepted = ACCEPTED_FLAGS[cmd];
  if (!accepted) return;
  const unknown = Object.keys(flags).filter((f) => !accepted.includes(f));
  if (unknown.length === 0) return;
  fail(
    `${cmd}: unknown flag(s) ${unknown.map((f) => `--${f}`).join(", ")}\n`
      + `  ${cmd} accepts: ${accepted.map((f) => `--${f}`).join(", ") || "(no flags)"}`,
  );
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  rejectUnknownFlags(cmd, flags);
  switch (cmd) {
    case "create":
      return cmdCreate(flags);
    case "show":
      return cmdShow(positional);
    case "list":
      return cmdList(flags);
    case "update":
      return cmdUpdate(positional, flags);
    case "close":
      return cmdClose(positional, flags);
    case "delete":
      return cmdDelete(positional, flags);
    default:
      console.error(
        "usage: beads-crud.mjs <create|show|list|update|close|delete> ...\nsee docs/specs/beads-issue-crud-scripts.spec.md",
      );
      process.exit(cmd ? 1 : 0);
  }
}

main();
