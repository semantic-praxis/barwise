/**
 * The exit log the recorder writes and the masked-exit hooks read
 * (docs/specs/masked-exit-report.spec.md). One home for its layout, the
 * read position, and the report wording, so the four hook modes cannot
 * disagree about any of them.
 */
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The base directory, as the hooks see it; SessionStart hands it to the
 * recorder. Per user: it is created 0700, so a shared name would lock out
 * every user after the first on a multi-user host.
 */
export function exitBase() {
  // process.getuid, not os.userInfo: the latter throws for a uid with no
  // passwd entry (a container run with an arbitrary --user).
  return join(tmpdir(), `barwise-exit-${process.getuid?.() ?? "user"}`);
}

/**
 * Refuses a base this user does not own alone. The path is predictable
 * under a shared /tmp, and an entry's label reaches the model, so a
 * directory someone else created (or opened) is a way to put text in
 * front of the agent. An absent base is fine: the recorder creates it
 * 0700. On a platform without uids only the type is checked.
 */
export function checkBase(base) {
  let st;
  try {
    st = lstatSync(base);
  } catch {
    return;
  }
  if (!st.isDirectory()) throw new Error(`${base} is not a directory`);
  if (process.getuid && st.uid !== process.getuid()) {
    throw new Error(`${base} is owned by uid ${st.uid}`);
  }
  if (process.getuid && (st.mode & 0o077) !== 0) {
    throw new Error(`${base} is open to other users (mode ${(st.mode & 0o777).toString(8)})`);
  }
}

/** At most this many processes are listed; the rest are counted. */
export const LIST_AT_MOST = 20;

/**
 * The NODE_OPTIONS token's prefix. The recorder strips tokens with it and
 * cannot import this module (it is inlined), so a drift test holds its
 * copy to this one.
 */
export const IMPORT_PREFIX = "--import=data:text/javascript;base64,";

/** Must agree with the join in hooks/exit-recorder.mjs; a drift test runs both. */
export function exitLogPath(base, session) {
  return join(base, session, "exits.jsonl");
}

function statePath(base, session) {
  return join(base, session, "state.json");
}

/**
 * Absent state is a fresh session: nothing read, nothing said. Each field
 * is checked, not merged blind: a bad `position` would fail every later
 * read the way an unchecked log line did.
 */
export function readState(base, session) {
  const fresh = { position: 0, everEntry: false, nodeCalls: 0, notArmedSaid: false };
  let saved = {};
  try {
    saved = JSON.parse(readFileSync(statePath(base, session), "utf8")) ?? {};
  } catch {
    return fresh;
  }
  const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);
  return {
    position: count(saved.position),
    everEntry: saved.everEntry === true,
    nodeCalls: count(saved.nodeCalls),
    notArmedSaid: saved.notArmedSaid === true,
  };
}

/** Written through a rename, so a concurrent reader never sees half a file. */
export function writeState(base, session, state) {
  const dir = join(base, session);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${statePath(base, session)}.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
  renameSync(tmp, statePath(base, session));
}

/**
 * Every complete line appended since `position`, parsed. A line without
 * its newline is a write in progress and is left for the next read. A log
 * shorter than the position was removed and recreated, so the read starts
 * again from the beginning rather than seeing nothing for the rest of the
 * session. An absent log is an empty one.
 */
export function readUnread(base, session, position) {
  const file = exitLogPath(base, session);
  if (!existsSync(file)) return { entries: [], unreadable: 0, position, size: 0 };
  const size = statSync(file).size;
  const from = size < position ? 0 : position;
  const length = size - from;
  if (length === 0) return { entries: [], unreadable: 0, position: from, size };
  const buf = Buffer.alloc(length);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buf, 0, length, from);
  } finally {
    closeSync(fd);
  }
  // Measured in bytes, never in decoded text: an invalid byte decodes to
  // a three-byte U+FFFD and would push the position past the next entry.
  const end = buf.lastIndexOf(0x0a) + 1;
  const entries = [];
  let unreadable = 0;
  for (const line of buf.subarray(0, end).toString("utf8").split("\n")) {
    if (line === "") continue;
    try {
      const e = JSON.parse(line);
      // The whole shape, not just the code: an entry report() cannot
      // print would throw there, before the read position is saved, and
      // wedge every later read on the same line.
      const ok = Number.isInteger(e?.code) && Number.isFinite(e?.t)
        && !Number.isNaN(new Date(e.t).getTime()) && typeof e?.label === "string";
      if (!ok) throw new Error("shape");
      entries.push(e);
    } catch {
      unreadable += 1;
    }
  }
  return { entries, unreadable, position: from + end, size };
}

/**
 * node, npm or npx as a command: first, or right after `&&`, `||`, `;`,
 * `|`, `(` or `$(`, past any `VAR=value` prefixes. A diagnostic for the
 * not-armed notice only, so `grep npm package.json` does not count.
 */
export function namesNode(command) {
  return /(?:^|&&|\|\||[;|(\n]|\$\()\s*(?:[A-Za-z_]\w*=\S*\s+)*(?:node|npm|npx)(?=\s|$)/.test(
    command ?? "",
  );
}

/**
 * The first line of each report, exported so the CLAUDE.md sentence that
 * quotes the post one is held to it by a drift test.
 */
export const HEADINGS = {
  post: "These processes exited non-zero, and the command still reported 0:",
  stop: "Before this turn ends: processes exited non-zero and no command's status showed it:",
  failure: (status) => `Non-zero exits read with this call (its status: ${status ?? "unknown"}):`,
};

/** The calls with node in command position before the silence counts as not armed. */
export const NOT_ARMED_AFTER = 3;

function clock(t) {
  return new Date(t).toISOString().slice(11, 19);
}

/**
 * What the model is told about the entries one read found, or null.
 * `kind` is "post" (the call exited 0), "failure" (it exited non-zero; the
 * agent saw a failure, not necessarily these) or "stop" (the turn is
 * ending with entries no call has read).
 */
export function report(kind, entries, unreadable, status) {
  const failed = entries.filter((e) => e.code !== 0 && !e.epipe);
  const piped = entries.filter((e) => e.epipe);
  if (failed.length === 0 && piped.length === 0 && unreadable === 0) return null;
  // A loop, not Math.max(...spread): a large unread delta overflowed the
  // stack before the read position was saved, wedging every later read.
  const shown = failed.slice(0, LIST_AT_MOST);
  const width = shown.reduce((w, e) => Math.max(w, e.label.length), 0);
  const lines = [];
  if (failed.length > 0) {
    lines.push(kind === "failure" ? HEADINGS.failure(status) : HEADINGS[kind]);
    for (const e of shown) {
      lines.push(`  ${e.label.padEnd(width)}   exit ${e.code}   ${clock(e.t)}`);
    }
    if (failed.length > shown.length) lines.push(`  ... and ${failed.length - shown.length} more`);
    if (kind !== "failure") {
      lines.push("The status was hidden (a pipe, or a later command), or you handled it.");
    }
  }
  for (const e of piped) {
    lines.push(`${e.label}: stopped by a closed pipe (| head?); its own result is unknown.`);
  }
  if (unreadable > 0) {
    lines.push(
      `${unreadable} unreadable exit-log entr${
        unreadable === 1 ? "y" : "ies"
      }; it may have been a failure.`,
    );
  }
  return lines.join("\n");
}

/**
 * Whether a node version accepts `--import` in NODE_OPTIONS (20.6 and
 * later). An older one exits 9 on every node command carrying it.
 */
export function acceptsImport(version) {
  const [major, minor] = version.split(".").map(Number);
  return major > 20 || (major === 20 && minor >= 6);
}

/** The two static lines the session's env file carries. */
export function envLines(base, recorderSource) {
  const b64 = Buffer.from(recorderSource, "utf8").toString("base64");
  return [
    `export BARWISE_EXIT_DIR="${base}"`,
    `export NODE_OPTIONS="${IMPORT_PREFIX}${b64}\${NODE_OPTIONS:+ $NODE_OPTIONS}"`,
  ];
}

/**
 * What to append to the env file, or null when every line of ours is
 * already there. Never a rewrite: the file is shared, and
 * session-start.sh appends to it with `>>` while this runs, so a
 * read-then-write would lose its lines. Appending is also enough when an
 * older recorder's line is already there (a resume across a recorder
 * change): the newer export comes later, so its token comes first in
 * NODE_OPTIONS; that recorder consumes the switch and strips both tokens,
 * and the older one, loaded second, records nothing.
 */
export function envAppend(existing, lines) {
  const rows = new Set(existing.split("\n"));
  if (lines.every((l) => rows.has(l))) return null;
  return `${existing !== "" && !existing.endsWith("\n") ? "\n" : ""}${lines.join("\n")}\n`;
}
