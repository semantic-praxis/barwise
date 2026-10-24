#!/usr/bin/env node
/**
 * Claude Code hooks that report a failure a Bash command's status hid
 * (docs/specs/masked-exit-report.spec.md, barwise-40a).
 *
 * `npm run test:scripts | tail -2; echo $?` printed 0 with a test failing,
 * and `mutate.mjs ... | tail -1` printed 0 while mutate had refused: the
 * status was tail's. Eleven drafts showed that predicting this from the
 * command line is a shadow that diverges wherever bash is clever, so the
 * exit codes are recorded instead (hooks/exit-recorder.mjs) and read here.
 *
 *   session  SessionStart: writes the two static env lines that arm the
 *            recorder in every later Bash command.
 *   post     PostToolUse on Bash: the call exited 0, so every non-zero exit
 *            read now is one no status showed.
 *   failure  PostToolUseFailure on Bash: the agent saw a failure, not
 *            necessarily these; listed, never judged and never silent,
 *            because every rule for "the status already showed it" was
 *            shown to swallow a masked failure.
 *   stop     Stop: the same read before a turn ends, so a background
 *            failure read only through the Read tool is not left unread.
 *
 * Exit 2 puts stderr in front of the model and blocks nothing (Post*) or
 * keeps the turn open once (Stop). A report mode that cannot answer says
 * so with exit 2 too: exit 1 reaches only a verbose transcript, where
 * "could not answer" would read as "nothing failed".
 */
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  acceptsImport,
  envAppend,
  envLines,
  exitBase,
  namesNode,
  NOT_ARMED_AFTER,
  readState,
  readUnread,
  report,
  writeState,
} from "../lib/exit-log.mjs";

const mode = process.argv[2];
// Read only by the modes that use it. session never reads stdin:
// session-start.sh records that a SessionStart pipe left open hangs an
// unbounded read, and this mode has no use for its input.
let input;
function readInput() {
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    input = undefined;
  }
}

function session() {
  const file = process.env.CLAUDE_ENV_FILE;
  if (!file) throw new Error("CLAUDE_ENV_FILE is not set");
  if (!acceptsImport(process.versions.node)) {
    throw new Error(`node ${process.versions.node} cannot --import in NODE_OPTIONS`);
  }
  const base = exitBase();
  // The base lands inside a double-quoted export; anything a shell reads
  // there would break every later command, so refuse instead.
  if (/["$`\\\n]/.test(base)) throw new Error(`unsafe characters in ${base}`);
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "exit-recorder.mjs"), "utf8");
  let existing = "";
  try {
    existing = readFileSync(file, "utf8");
  } catch {
    // A new file.
  }
  const append = envAppend(existing, envLines(base, source));
  if (append) appendFileSync(file, append);
}

function read(kind) {
  readInput();
  // A Stop that already held the turn open does not read again: a
  // background loop that keeps failing would otherwise hold it forever.
  // What it would have read stays unread for the next call.
  if (kind === "stop" && input?.stop_hook_active) process.exit(0);
  const sid = input?.session_id;
  if (typeof sid !== "string" || sid === "") throw new Error("no session_id in the hook input");
  const base = exitBase();
  const state = readState(base, sid);
  const got = readUnread(base, sid, state.position);
  state.position = got.position;
  if (got.size > 0) state.everEntry = true;
  const out = [];
  const status = /^Exit code (\d+)/.exec(String(input?.error ?? ""))?.[1];
  const said = report(kind, got.entries, got.unreadable, status && `exit ${status}`);
  if (said) out.push(said);
  if (kind !== "stop" && namesNode(input?.tool_input?.command)) state.nodeCalls += 1;
  if (!state.everEntry && !state.notArmedSaid && state.nodeCalls >= NOT_ARMED_AFTER) {
    state.notArmedSaid = true;
    out.push(
      "The exit recorder is not recording: non-zero exits hidden by a pipe or a later command\n"
        + "will not be reported this session (docs/specs/masked-exit-report.spec.md).",
    );
  }
  writeState(base, sid, state);
  if (out.length === 0) process.exit(0);
  console.error(out.join("\n\n"));
  process.exit(2);
}

try {
  if (mode === "session") {
    session();
  } else if (mode === "post" || mode === "failure" || mode === "stop") {
    read(mode);
  } else {
    throw new Error(`unknown mode ${mode ?? "(none)"}`);
  }
} catch (err) {
  console.error(`masked-exit ${mode ?? ""}: could not answer -- ${err.message}`);
  // SessionStart has no model-facing use for the notice, and a Stop that
  // keeps failing must not hold the turn open forever.
  process.exit(mode === "session" || (mode === "stop" && input?.stop_hook_active) ? 1 : 2);
}
