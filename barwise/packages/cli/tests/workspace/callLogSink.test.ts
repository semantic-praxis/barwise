/**
 * Where the observability records land, and when they do not
 * (docs/specs/llm-call-observability.spec.md workstream 2).
 *
 * `withCallLog` and `summariseExtraction` shipped computing records
 * with nowhere to put them -- a decorator with zero call sites for a
 * day, then a week. This is the half that makes them real, and the
 * tests that matter are the negative ones: recording is opt-in, and a
 * sink that cannot write must not take the command down with it.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callLogPath, callLogSink, jsonlSink, stateDir } from "../../src/workspace/callLogSink.js";

const SAVED = { ...process.env };
let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "barwise-calllog-"));
});

afterEach(() => {
  process.env = { ...SAVED };
  rmSync(tmp, { recursive: true, force: true });
});

describe("the opt-in gate", () => {
  it("records nothing when BARWISE_CALL_LOG is unset", () => {
    delete process.env["BARWISE_CALL_LOG"];

    expect(callLogPath()).toBeUndefined();
    expect(callLogSink()).toBeUndefined();
  });

  it("records nothing when it is set but empty", () => {
    // An exported-but-blank variable is how an operator turns this off
    // again, and it must not be read as "on, at the default path".
    process.env["BARWISE_CALL_LOG"] = "";

    expect(callLogPath()).toBeUndefined();
  });

  it("uses the state directory for 1 or true", () => {
    process.env["XDG_STATE_HOME"] = tmp;
    for (const flag of ["1", "true", "TRUE"]) {
      process.env["BARWISE_CALL_LOG"] = flag;
      expect(callLogPath()).toBe(join(tmp, "barwise", "calls.jsonl"));
    }
  });

  it("falls back to ~/.local/state when XDG_STATE_HOME is unset", () => {
    delete process.env["XDG_STATE_HOME"];
    process.env["BARWISE_CALL_LOG"] = "1";

    expect(callLogPath()).toBe(join(homedir(), ".local", "state", "barwise", "calls.jsonl"));
  });

  it("treats any other value as the path itself", () => {
    // So a single run can be pointed elsewhere without exporting a
    // variable the operator then forgets about.
    const custom = join(tmp, "one-off.jsonl");
    process.env["BARWISE_CALL_LOG"] = custom;

    expect(callLogPath()).toBe(custom);
  });

  it("puts the default under the same state directory the gym uses", () => {
    process.env["XDG_STATE_HOME"] = tmp;

    expect(stateDir()).toBe(join(tmp, "barwise"));
  });
});

describe("the JSONL sink", () => {
  it("appends one line per record, creating the directory", () => {
    const path = join(tmp, "nested", "deeper", "calls.jsonl");
    const sink = jsonlSink(path);

    sink.record({ startedAt: "t1", provider: "anthropic", model: "m", ok: true });
    sink.record({ startedAt: "t2", provider: "anthropic", model: "m", ok: false });

    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).startedAt).toBe("t1");
    expect(JSON.parse(lines[1]!).ok).toBe(false);
  });

  it("creates no file until something is recorded", () => {
    // "when recording is disabled, the system shall create no file",
    // and the same courtesy when it is enabled but nothing happened.
    const path = join(tmp, "untouched.jsonl");
    jsonlSink(path);

    expect(existsSync(path)).toBe(false);
  });

  it("does not throw when the path cannot be written", () => {
    // The rule both emitters already follow, asserted at the sink too
    // rather than relying on them: observability that can fail the
    // operation it observes is worse than none. A file where a
    // directory must go is the cheap way to make the write fail.
    const blocker = join(tmp, "blocked");
    jsonlSink(blocker).record({
      startedAt: "t",
      provider: "p",
      model: undefined,
      ok: true,
    });
    const nested = jsonlSink(join(blocker, "calls.jsonl"));

    expect(() => nested.record({ startedAt: "t", provider: "p", model: undefined, ok: true }))
      .not.toThrow();
  });

  it("accepts an extraction record as well as a call record", () => {
    // One file, two record kinds, correlated by the caller's id -- what
    // a call cost and what the pipeline did with its answer.
    const path = join(tmp, "both.jsonl");
    const sink = jsonlSink(path);

    sink.record({ startedAt: "t", provider: "p", model: undefined, ok: true, correlationId: "x" });
    sink.record({
      startedAt: "t",
      correlationId: "x",
      correctionsByCategory: { arity_mismatch: 1 },
      corrections: 1,
      parserWarnings: 0,
      constraintsSkipped: 0,
      built: { objectTypes: 2, factTypes: 1, constraints: 0 },
    });

    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).correlationId).toBe(JSON.parse(lines[1]!).correlationId);
  });
});
