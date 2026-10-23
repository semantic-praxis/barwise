/**
 * The exit log the recorder writes and the masked-exit hooks read
 * (docs/specs/masked-exit-report.spec.md). One home for its layout, the
 * read position, and the report wording, so the four hook modes cannot
 * disagree about any of them.
 */
import {
  closeSync,
  existsSync,
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

/** The base directory, as the hooks see it. SessionStart hands it to the recorder. */
export function exitBase() {
  return join(tmpdir(), "barwise-exit");
}

/** Must agree with the join in hooks/exit-recorder.mjs; a drift test runs both. */
export function exitLogPath(base, session) {
  return join(base, session, "exits.jsonl");
}

function statePath(base, session) {
  return join(base, session, "state.json");
}

/** Absent state is a fresh session: nothing read, nothing said. */
export function readState(base, session) {
  const fresh = { position: 0, everEntry: false, nodeCalls: 0, notArmedSaid: false };
  try {
    return { ...fresh, ...JSON.parse(readFileSync(statePath(base, session), "utf8")) };
  } catch {
    return fresh;
  }
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
  const text = buf.toString("utf8");
  const end = text.lastIndexOf("\n") + 1;
  const entries = [];
  let unreadable = 0;
  for (const line of text.slice(0, end).split("\n")) {
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
  return { entries, unreadable, position: from + Buffer.byteLength(text.slice(0, end)), size };
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
  const width = Math.max(0, ...failed.map((e) => e.label.length));
  const lines = [];
  if (failed.length > 0) {
    lines.push(kind === "failure" ? HEADINGS.failure(status) : HEADINGS[kind]);
    for (const e of failed) {
      lines.push(`  ${e.label.padEnd(width)}   exit ${e.code}   ${clock(e.t)}`);
    }
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
    `export NODE_OPTIONS="--import=data:text/javascript;base64,${b64}\${NODE_OPTIONS:+ $NODE_OPTIONS}"`,
  ];
}

const KINDS = [
  /^export BARWISE_EXIT_DIR=/,
  /^export NODE_OPTIONS="--import=data:text\/javascript;base64,/,
];

/**
 * What the env file needs: null when it already holds exactly our lines;
 * `{ append }` when it holds no line of our kinds, so the common path is
 * an append that cannot race another hook's append (session-start.sh's
 * `persist_env` writes with `>>`); `{ replace }` only when an older line
 * of ours is there (a resume across a recorder change), so one recorder
 * is left, not two. Every other line, blank ones included, is kept as it
 * was: the file is shared, and only our two kinds of line are ours.
 */
export function envFileChange(existing, lines) {
  const rows = existing === "" ? [] : existing.replace(/\n$/, "").split("\n");
  const ours = rows.filter((l) => KINDS.some((k) => k.test(l)));
  if (ours.length === lines.length && ours.every((l, i) => l === lines[i])) return null;
  if (ours.length === 0) {
    return {
      append: `${existing !== "" && !existing.endsWith("\n") ? "\n" : ""}${lines.join("\n")}\n`,
    };
  }
  const kept = rows.filter((l) => !KINDS.some((k) => k.test(l)));
  return { replace: `${[...kept, ...lines].join("\n")}\n` };
}
