/**
 * Where the observability records actually land
 * (docs/specs/llm-call-observability.spec.md workstream 2, and
 * docs/specs/pipeline-observability.spec.md).
 *
 * `withCallLog` and `summariseExtraction` compute records and hand them
 * to a sink; nothing in `@barwise/llm` writes files or reads a clock.
 * This is the CLI's half of that seam -- the same shape as
 * `resolveProvenance` and the gym's session log, and it writes to the
 * same state directory the gym already uses.
 *
 * **Opt-in, via `BARWISE_CALL_LOG`.** Recording costs nothing and
 * answers questions nobody can currently answer, which argues for
 * on-by-default; writing to a user's disk without being asked argues
 * the other way, and that argument wins for one release. The spec's
 * own note applies: an opt-in nobody enables is a feature that does not
 * exist, so revisit this with evidence rather than leaving it opt-in
 * forever by default.
 *
 * The log grows without bound and there is deliberately no rotation. A
 * JSONL file the operator can delete is a smaller problem than a
 * retention policy nobody asked for -- said here rather than left as an
 * accident.
 */

import type { ExtractionRecord, LlmCallRecord, ValidationRecord } from "@barwise/llm";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Everything the log can hold.
 *
 * One file, three record kinds, correlated by the caller's id: what a
 * call cost, what the pipeline changed, and what validation found. They
 * are distinguishable on read -- a call record carries `ok`, the others
 * do not -- which is what lets `barwise llm-usage` skip what it does
 * not understand rather than choke on it.
 */
export type Observation = LlmCallRecord | ExtractionRecord | ValidationRecord;

/** `$XDG_STATE_HOME/barwise/`, falling back to `~/.local/state/barwise/`. */
export function stateDir(): string {
  const base = process.env["XDG_STATE_HOME"] && process.env["XDG_STATE_HOME"] !== ""
    ? process.env["XDG_STATE_HOME"]
    : join(homedir(), ".local", "state");
  return join(base, "barwise");
}

/**
 * The log file, or undefined when recording is off.
 *
 * `BARWISE_CALL_LOG` unset or empty means off. Set to `1` or `true`
 * means the default path; any other value is taken as the path itself,
 * so an operator can point a single run somewhere else without
 * exporting a variable they then forget about.
 */
export function callLogPath(): string | undefined {
  const flag = process.env["BARWISE_CALL_LOG"];
  if (flag === undefined || flag === "") return undefined;
  if (flag === "1" || flag.toLowerCase() === "true") {
    return join(stateDir(), "calls.jsonl");
  }
  return flag;
}

/**
 * A sink that appends one JSON line per record.
 *
 * Never throws: both emitters swallow a failing sink deliberately, and
 * this makes sure the common failure -- a state directory that cannot
 * be created -- is silent at the source rather than relying on that.
 * Observability that can fail the operation it observes is worse than
 * none.
 */
export function jsonlSink(path: string): { record(entry: Observation): void; } {
  let ready = false;
  return {
    record(entry): void {
      try {
        if (!ready) {
          mkdirSync(dirname(path), { recursive: true });
          ready = true;
        }
        appendFileSync(path, JSON.stringify(entry) + "\n");
      } catch {
        // Deliberately silent; see above.
      }
    },
  };
}

/**
 * The sink for this process, or undefined when recording is off.
 *
 * Callers wrap their client with `withCallLog(client, sink)` and pass
 * the same sink as `ProcessorOptions.observer`, so a call's cost and
 * what the pipeline did with its answer land in one file, correlated
 * by the id the caller supplies.
 */
export function callLogSink(): { record(entry: Observation): void; } | undefined {
  const path = callLogPath();
  return path === undefined ? undefined : jsonlSink(path);
}
