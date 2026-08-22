/**
 * barwise llm-usage
 *
 * The report over the call log
 * (docs/specs/llm-call-observability.spec.md, workstream 3). Workstream
 * 1 built the record, workstream 2 the sink; until this, the log
 * accumulated and nothing read it, so "what did that extraction cost"
 * and "how much slower is one model on a long transcript" stayed
 * unanswerable -- which is the whole of task #2.
 *
 * Two decisions the spec left open and this settles:
 *
 * **No prices ship with the repo.** Cost needs rates, rates go stale,
 * and a stale rate produces a confidently wrong number -- worse than
 * none, and exactly the class of defect this line of work exists to
 * stop. `--rates <file>` takes a small user-maintained JSON. A
 * checked-in table with a "last verified" date is friendlier for one
 * release and misleading for every release after.
 *
 * **Percentiles, not just a mean.** A mean latency hides the tail that
 * actually hurts, and the tail is what a timeout is set against.
 */

import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { callLogPath } from "../workspace/callLogSink.js";

/** A row of the log this report understands; others are ignored. */
interface CallRow {
  readonly provider?: string;
  readonly model?: string;
  readonly modelUsed?: string;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly latencyMs?: number;
  readonly ok?: boolean;
  readonly errorKind?: string;
}

interface Rates {
  /** Per million tokens, the unit every provider publishes. */
  readonly [model: string]: { readonly input?: number; readonly output?: number; };
}

interface Bucket {
  calls: number;
  failures: number;
  promptTokens: number;
  completionTokens: number;
  latencies: number[];
  errorKinds: Record<string, number>;
}

export function registerLlmUsageCommand(program: Command): void {
  program
    .command("llm-usage")
    .description("Summarise the LLM call log: calls, tokens, latency, and cost")
    .option("--log <file>", "Call log to read (defaults to the configured path)")
    .option(
      "--rates <file>",
      "JSON of per-model rates per million tokens, e.g."
        + ' {"claude-haiku-4-5": {"input": 1, "output": 5}}. No rates ship with barwise.',
    )
    .option("--format <format>", "Output format (text or json)", "text")
    .action((opts: { log?: string; rates?: string; format: string; }) => {
      try {
        const path = opts.log ?? callLogPath();
        if (path === undefined) {
          // Not an error: the operator has simply not turned recording
          // on, and saying so beats an empty table they have to
          // interpret.
          process.stderr.write(
            "No call log configured. Set BARWISE_CALL_LOG=1 to start recording,"
              + " or pass --log <file>.\n",
          );
          return;
        }
        if (!existsSync(path)) {
          process.stderr.write(
            `No call log at ${path}. It is written on the first recorded call.\n`,
          );
          return;
        }

        const rates = opts.rates === undefined
          ? undefined
          : (JSON.parse(readFileSync(opts.rates, "utf-8")) as Rates);

        const buckets = summarise(readRows(path));
        process.stdout.write(
          opts.format === "json"
            ? JSON.stringify(renderJson(buckets, rates), null, 2) + "\n"
            : renderText(buckets, rates),
        );
      } catch (err) {
        process.stderr.write(`Error: ${(err as Error).message}\n`);
        process.exitCode = 1;
      }
    });
}

/**
 * Read the log, skipping anything that is not a call row.
 *
 * One file carries call records, extraction records and validation
 * records, correlated by id. A malformed line is skipped rather than
 * fatal: a log is append-only and a half-written final line is the
 * normal consequence of a process dying, which must not cost the
 * operator the other ten thousand rows.
 */
function readRows(path: string): CallRow[] {
  const rows: CallRow[] = [];
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line) as CallRow;
      // `ok` is the field only a call record carries.
      if (typeof parsed.ok === "boolean") rows.push(parsed);
    } catch {
      continue;
    }
  }
  return rows;
}

/** Group by the model that actually answered, falling back to the one asked for. */
function summarise(rows: readonly CallRow[]): Map<string, Bucket> {
  const buckets = new Map<string, Bucket>();
  for (const r of rows) {
    // `modelUsed` is what answered; `model` is what was asked for. The
    // first is the truth about the bill and the second is all a
    // provider that cannot name its model in advance can offer.
    const key = r.modelUsed ?? r.model ?? `${r.provider ?? "unknown"} (unnamed model)`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        calls: 0,
        failures: 0,
        promptTokens: 0,
        completionTokens: 0,
        latencies: [],
        errorKinds: {},
      };
      buckets.set(key, b);
    }
    b.calls += 1;
    if (r.ok === false) {
      b.failures += 1;
      const kind = r.errorKind ?? "other";
      b.errorKinds[kind] = (b.errorKinds[kind] ?? 0) + 1;
    }
    b.promptTokens += r.promptTokens ?? 0;
    b.completionTokens += r.completionTokens ?? 0;
    if (r.latencyMs !== undefined) b.latencies.push(r.latencyMs);
  }
  return buckets;
}

/**
 * Nearest-rank percentile.
 *
 * Undefined for an empty sample rather than 0, the same distinction the
 * dispersion module makes: no observations is not a fast call.
 */
export function percentile(values: readonly number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

function costOf(
  b: Bucket,
  model: string,
  rates: Rates | undefined,
): number | undefined {
  const rate = rates?.[model];
  if (rate === undefined) return undefined;
  return (b.promptTokens / 1_000_000) * (rate.input ?? 0)
    + (b.completionTokens / 1_000_000) * (rate.output ?? 0);
}

function renderJson(buckets: Map<string, Bucket>, rates: Rates | undefined): unknown {
  return {
    models: [...buckets].map(([model, b]) => ({
      model,
      calls: b.calls,
      failures: b.failures,
      promptTokens: b.promptTokens,
      completionTokens: b.completionTokens,
      medianLatencyMs: percentile(b.latencies, 50),
      p95LatencyMs: percentile(b.latencies, 95),
      ...(Object.keys(b.errorKinds).length > 0 ? { errorKinds: b.errorKinds } : {}),
      ...(costOf(b, model, rates) !== undefined ? { cost: costOf(b, model, rates) } : {}),
    })),
  };
}

function renderText(buckets: Map<string, Bucket>, rates: Rates | undefined): string {
  if (buckets.size === 0) return "No calls recorded.\n";

  const lines: string[] = [];
  for (const [model, b] of [...buckets].sort((a, b2) => b2[1].calls - a[1].calls)) {
    const med = percentile(b.latencies, 50);
    const p95 = percentile(b.latencies, 95);
    lines.push(model);
    lines.push(
      `  calls ${b.calls}${b.failures > 0 ? ` (${b.failures} failed)` : ""}`
        + `   in ${b.promptTokens.toLocaleString()}`
        + `   out ${b.completionTokens.toLocaleString()}`,
    );
    // Absent rather than zero when nothing reported a latency: Copilot
    // reports none, and "0 ms" would be a claim the log never made.
    lines.push(
      `  latency  median ${med === undefined ? "n/a" : `${med} ms`}`
        + `   p95 ${p95 === undefined ? "n/a" : `${p95} ms`}`,
    );
    const kinds = Object.entries(b.errorKinds).sort((x, y) => y[1] - x[1]);
    if (kinds.length > 0) {
      lines.push(`  failures ${kinds.map(([k, n]) => `${k} x${n}`).join(", ")}`);
    }
    const cost = costOf(b, model, rates);
    if (cost !== undefined) lines.push(`  cost     ${cost.toFixed(4)}`);
    else if (rates !== undefined) lines.push("  cost     n/a (no rate for this model)");
    lines.push("");
  }
  if (rates === undefined) {
    lines.push("Pass --rates <file> for cost. No rates ship with barwise: a stale");
    lines.push("price produces a confidently wrong number, which is worse than none.");
  }
  return lines.join("\n") + "\n";
}
