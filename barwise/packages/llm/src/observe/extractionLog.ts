/**
 * A record of what the pipeline changed on the way to a model
 * (docs/specs/pipeline-observability.spec.md).
 *
 * The sibling of `callLog.ts`, and the distinction between them is the
 * point: that one records what a call *cost*, this one records what the
 * pipeline *did*. Conformance rewrites the payload before the parser
 * sees it -- dropping malformed constraints, dropping incomplete
 * population instances, clearing misplaced flags -- and every one of
 * those is a silent edit to the user's model unless something keeps it.
 *
 * It does not live on `DraftModelResult`. That type answers "what model
 * did this transcript produce, and where did each part come from";
 * corrections answer "what did a cleanup pass change". Merging them
 * widens an interface without removing anything a reader has to think
 * about, and the type is already carrying `modelUsed`, `usage` and
 * `latencyMs`, which are call telemetry that belongs here rather than
 * there.
 *
 * **Categories and identities, never content.** A correction's
 * `description` quotes the constraint's own description, which is
 * transcript-derived wording, so it is deliberately not what gets
 * recorded. The category and the element name are. A telemetry file
 * that quietly accumulated the transcripts users feed it would be that
 * mistake written to disk and forgotten.
 */

import type { ConformanceCorrection } from "../ExtractionConformance.js";

export interface ExtractionRecord {
  /** Caller-supplied, because this package reads no clock. */
  readonly startedAt: string;
  /** Groups this with the calls of the same operation. */
  readonly correlationId?: string;
  /** Conformance corrections by category, never their prose. */
  readonly correctionsByCategory: Readonly<Record<string, number>>;
  /** Total corrections applied, so a reader need not sum the map. */
  readonly corrections: number;
  /**
   * Parser warnings that were emitted. A count, because their text is
   * assembled from element names the transcript supplied.
   */
  readonly parserWarnings: number;
  /**
   * Inferred constraints the parser declined to build, by the reason it
   * gave. `skipReason` is authored in this repository from a fixed set
   * of phrasings, but it interpolates fact type and role names, so the
   * reason is reduced to its leading clause rather than stored whole.
   */
  readonly constraintsSkipped: number;
  /** Fact types, object types, and constraints that reached the model. */
  readonly built: {
    readonly objectTypes: number;
    readonly factTypes: number;
    readonly constraints: number;
  };
}

export interface ExtractionLogSink {
  record(entry: ExtractionRecord): void;
}

/**
 * Summarise one extraction into a record.
 *
 * Pure: the caller supplies the clock and the persistence, exactly as
 * the history writer's date and build provenance arrive from the CLI.
 * `processTranscript` calls this and hands the result to a sink; a
 * caller that supplies no sink pays for nothing.
 */
export function summariseExtraction(input: {
  readonly startedAt: string;
  readonly correlationId?: string;
  readonly corrections: readonly ConformanceCorrection[];
  readonly parserWarnings: readonly string[];
  readonly constraintsSkipped: number;
  readonly built: {
    readonly objectTypes: number;
    readonly factTypes: number;
    readonly constraints: number;
  };
}): ExtractionRecord {
  const correctionsByCategory: Record<string, number> = {};
  for (const c of input.corrections) {
    correctionsByCategory[c.category] = (correctionsByCategory[c.category] ?? 0) + 1;
  }

  return {
    startedAt: input.startedAt,
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
    correctionsByCategory,
    corrections: input.corrections.length,
    parserWarnings: input.parserWarnings.length,
    constraintsSkipped: input.constraintsSkipped,
    built: input.built,
  };
}

/**
 * Hand a record to a sink without letting the sink break the caller.
 *
 * Same rule as `withCallLog`: observability that can fail the operation
 * it observes is worse than none, and a warning on stderr would print
 * noise into the middle of a command's real output for a failure the
 * operator cannot act on mid-run.
 */
export function emitExtractionRecord(
  sink: ExtractionLogSink | undefined,
  entry: ExtractionRecord,
): void {
  if (sink === undefined) return;
  try {
    sink.record(entry);
  } catch {
    // Deliberately silent; see above.
  }
}
