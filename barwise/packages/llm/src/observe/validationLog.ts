/**
 * A record of what validation found
 * (docs/specs/pipeline-observability.spec.md, barwise-838).
 *
 * The third record in `observe/`, and the one the spec asked for and
 * the first pass did not build. `callLog.ts` records what a call cost,
 * `extractionLog.ts` what the pipeline changed, and this what the model
 * was judged to be.
 *
 * It is separate from the extraction record rather than folded into it
 * because the two happen at different moments. Extraction never
 * validates -- `ValidationEngine` is constructed downstream, at more
 * than a dozen call sites -- so a single record would be half-empty
 * depending on who emitted it. Keeping them apart is also what lets
 * this one be emitted by surfaces that never extract at all: validating
 * a hand-written model is exactly as worth recording as validating one
 * that came from a transcript.
 *
 * **Rule ids and severities, never messages.** A diagnostic's message
 * interpolates element names -- fact type names, role names, object
 * type names -- which on an extracted model came from the transcript.
 * The same no-content rule that governs correction descriptions governs
 * these, and for the same reason.
 */

/** The shape this module needs from a diagnostic; `core` owns the real one. */
export interface DiagnosticLike {
  readonly severity: string;
  readonly ruleId?: string;
}

export interface ValidationRecord {
  /** Caller-supplied, because this package reads no clock. */
  readonly startedAt: string;
  /** Groups this with the calls and extraction of the same operation. */
  readonly correlationId?: string;
  /**
   * What was validated, as a caller-chosen label -- a command name, a
   * surface. Deliberately not a file path: a path is the user's
   * directory layout, which is theirs and not ours to accumulate.
   */
  readonly source: string;
  readonly errors: number;
  readonly warnings: number;
  /** Every rule that fired, by id, split by severity. */
  readonly errorsByRule: Readonly<Record<string, number>>;
  readonly warningsByRule: Readonly<Record<string, number>>;
}

export interface ValidationLogSink {
  record(entry: ValidationRecord): void;
}

/**
 * Summarise a validation run into a record. Pure; the caller supplies
 * the clock and the persistence.
 */
export function summariseValidation(input: {
  readonly startedAt: string;
  readonly correlationId?: string;
  readonly source: string;
  readonly diagnostics: readonly DiagnosticLike[];
}): ValidationRecord {
  const errorsByRule: Record<string, number> = {};
  const warningsByRule: Record<string, number> = {};
  let errors = 0;
  let warnings = 0;

  for (const d of input.diagnostics) {
    // An unattributed diagnostic is still a diagnostic. Dropping it
    // would make the tally disagree with the count, which is the one
    // failure a count-only field could never have exposed.
    const id = d.ruleId ?? "(unattributed)";
    if (d.severity === "error") {
      errors += 1;
      errorsByRule[id] = (errorsByRule[id] ?? 0) + 1;
    } else if (d.severity === "warning") {
      warnings += 1;
      warningsByRule[id] = (warningsByRule[id] ?? 0) + 1;
    }
    // `info` is deliberately neither counted nor tallied: it carries no
    // weight in any score and recording it would grow every row for a
    // tier nobody acts on.
  }

  return {
    startedAt: input.startedAt,
    ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
    source: input.source,
    errors,
    warnings,
    errorsByRule,
    warningsByRule,
  };
}

/**
 * Hand a record to a sink without letting the sink break the caller.
 * Same rule as the other two emitters.
 */
export function emitValidationRecord(
  sink: ValidationLogSink | undefined,
  entry: ValidationRecord,
): void {
  if (sink === undefined) return;
  try {
    sink.record(entry);
  } catch {
    // Deliberately silent: observability that can fail the operation it
    // observes is worse than none.
  }
}
