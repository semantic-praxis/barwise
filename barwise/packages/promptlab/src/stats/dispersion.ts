/**
 * How much of a reported mean is sampling noise
 * (docs/specs/eval-run-resolution-and-provenance.spec.md, workstream 1).
 *
 * Pure arithmetic over scores `runSuite` already collected: no I/O, no
 * clock, no extra API call. It lives in its own module rather than
 * inline in the runner so the formulas can be tested against known
 * inputs -- a wrong denominator is invisible when the only test is a
 * mock client returning canned payloads.
 *
 * The reason this exists: a `SuiteReport` states a mean to three
 * decimal places and used to say nothing about its precision, so every
 * reader who quoted one implicitly claimed a precision the run did not
 * have. Two configurations were ranked on gaps well inside the noise.
 */

/**
 * Two-sided 95% normal quantile.
 *
 * A normal approximation, not a t-quantile. At the sample sizes this
 * harness runs the true interval is slightly wider, so a reported
 * interval is mildly optimistic -- accepted deliberately (see the
 * spec's Open decisions) because the gaps we face are several times
 * the threshold either way, and carrying a t-table would not change a
 * single decision.
 */
const Z95 = 1.96;

export interface Dispersion {
  /**
   * Standard error of the suite mean. Absent when no case has two or
   * more scored samples -- with one sample per case, nothing about the
   * spread is knowable, and reporting 0 would claim the opposite.
   */
  readonly standardError?: number;
  /**
   * True when some scored case had fewer than two samples, so its
   * variance is unknown and counted as zero. When `standardError` is
   * present it therefore understates; when absent, nothing could be
   * computed at all.
   */
  readonly lowerBound: boolean;
  /**
   * The smallest gap between two comparable runs that this run's
   * precision resolves at 95%. Assumes the run being compared against
   * has similar dispersion, which is why "comparable" is in the
   * sentence.
   */
  readonly resolvableDifference?: number;
  /**
   * The case contributing the largest share of the suite mean's
   * variance, and that share. Typically the whole story: in both
   * recorded runs a single case carried over three quarters of the
   * noise, so averaging harder was never the fix.
   */
  readonly dominantCase?: { readonly caseId: string; readonly share: number; };
}

/** What `dispersionOf` needs from each case. */
export interface CaseDispersionInput {
  readonly caseId: string;
  /** Sample standard deviation, absent when the case has under two samples. */
  readonly sd?: number;
  /** Runs that produced a score -- the denominator behind the case mean. */
  readonly samples: number;
}

/**
 * Sample standard deviation (Bessel-corrected).
 *
 * Undefined rather than 0 for a single sample. One observation says
 * nothing about spread, and a 0 here would propagate into a standard
 * error claiming perfect precision -- the exact failure this module
 * exists to prevent.
 */
export function sampleSd(scores: readonly number[]): number | undefined {
  if (scores.length < 2) return undefined;
  const mean = scores.reduce((sum, v) => sum + v, 0) / scores.length;
  const squares = scores.reduce((sum, v) => sum + (v - mean) ** 2, 0);
  return Math.sqrt(squares / (scores.length - 1));
}

/**
 * Fold per-case dispersion into the suite mean's.
 *
 * The suite mean is the unweighted mean of k per-case means, so its
 * variance is the sum of the per-case mean variances over k^2, and
 * each per-case mean variance is that case's variance over its own
 * sample count. Cases with unknown variance contribute zero and are
 * still counted in k -- they are in the mean, so excluding them would
 * misstate it. That understatement is what `lowerBound` announces.
 */
export function dispersionOf(cases: readonly CaseDispersionInput[]): Dispersion {
  const scored = cases.filter((c) => c.samples > 0);
  if (scored.length === 0) return { lowerBound: false };

  const lowerBound = scored.some((c) => c.sd === undefined);

  // Each case's contribution to the variance of the suite mean, before
  // the 1/k^2. Kept per case so the dominant one can be named.
  const contributions = scored.map((c) => ({
    caseId: c.caseId,
    variance: c.sd === undefined ? 0 : (c.sd * c.sd) / c.samples,
  }));
  const total = contributions.reduce((sum, c) => sum + c.variance, 0);

  if (total === 0) {
    // Either nothing had two samples, or every sample was identical.
    // The second is a real result (a perfectly stable config) and gets
    // a standard error of 0; the first knows nothing and gets none.
    return lowerBound && scored.every((c) => c.sd === undefined)
      ? { lowerBound: true }
      : { standardError: 0, lowerBound, resolvableDifference: 0 };
  }

  const standardError = Math.sqrt(total) / scored.length;
  const dominant = contributions.reduce((a, b) => (b.variance > a.variance ? b : a));

  return {
    standardError,
    lowerBound,
    // Comparing two independent runs, the difference's standard error
    // is sqrt(SEa^2 + SEb^2); assuming comparable dispersion makes that
    // SE * sqrt(2).
    resolvableDifference: Z95 * standardError * Math.SQRT2,
    dominantCase: { caseId: dominant.caseId, share: dominant.variance / total },
  };
}

/**
 * Split a case's scored samples at the suite's collapse floor
 * (docs/specs/eval-metric-readiness.spec.md).
 *
 * A run of a case answers two questions at once -- did the extraction
 * survive at all, and how good was it when it did -- and averaging them
 * blends a near-Bernoulli variable with a tight one. On the recorded
 * 2026-08-21 runs, one bimodal case carried 60% and 91% of all
 * variance; separating the two populations moved the same comparison
 * from unresolved to resolved without a single extra call.
 *
 * `quality` is empty rather than zero-filled when everything collapsed:
 * a configuration that never produced a usable model has no quality to
 * report, which is not the same as modelling badly.
 */
export function splitAtFloor(
  scores: readonly number[],
  floor: number,
): { readonly collapses: number; readonly quality: readonly number[]; } {
  const quality = scores.filter((s) => s >= floor);
  return { collapses: scores.length - quality.length, quality };
}

/**
 * Half-width of the 95% interval around a mean -- the "+/-" that
 * belongs next to any mean this harness prints.
 *
 * Takes the standard error rather than a `Dispersion` so it also serves
 * a recorded history row, which carries the error and not the rest.
 * That keeps `Z95` in one place: a caller that multiplies by 1.96
 * itself is a caller that will get a different confidence level than
 * the runner reports.
 */
export function marginOfError(standardError: number | undefined): number | undefined {
  return standardError === undefined ? undefined : Z95 * standardError;
}
