/**
 * Retry policy for the eval lane (barwise-806).
 *
 * An unattended sweep is where a transient provider failure is most
 * expensive: it turns into a recorded number that looks like a score.
 * Retrying the failures that deserve it removes most of that, but the
 * two failure classes need opposite handling -- retrying a rejected
 * credential just fails more slowly, and burns the operator's time
 * proving something already known on the first attempt.
 *
 * Classification is by HTTP status where the provider SDK gives one,
 * and by message otherwise. When neither is recognizable the failure is
 * treated as terminal: giving up early on an unknown error is cheaper
 * to diagnose than a silent five-attempt loop.
 */

/** Retry knobs; every field has a default so callers can pass nothing. */
export interface RetryOptions {
  /** Total attempts including the first (default 3). */
  readonly attempts?: number;
  /** Delay before the second attempt, doubling thereafter (default 1000ms). */
  readonly baseDelayMs?: number;
  /** Injected for tests, so the suite does not actually sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** What a failed attempt was judged to be. */
export type FailureKind = "transient" | "terminal";

const TRANSIENT_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504, 529]);
const TERMINAL_STATUSES = new Set([400, 401, 403, 404, 422]);

/**
 * Checked before the terminal patterns. Providers routinely name the
 * credential while rejecting a request for throughput -- "rate limit
 * exceeded for your api key" is a retryable rate limit, not an auth
 * failure, and generic terminal wording must not capture it.
 */
const RETRYABLE_FIRST_PATTERNS = [
  /\brate limit/i,
  /\brate.?limited\b/i,
  /\bquota exceeded\b/i,
  /\btoo many requests\b/i,
  /\boverloaded\b/i,
];

const TERMINAL_PATTERNS = [
  /could not resolve authentication/i,
  /\bapi key\b/i,
  /\bauthentication\b/i,
  /\bunauthorized\b/i,
  /\bpermission\b/i,
];

const TRANSIENT_PATTERNS = [
  /\btimeout\b/i,
  /\btimed out\b/i,
  /\bECONNRESET\b/,
  /\bECONNREFUSED\b/,
  /\bETIMEDOUT\b/,
  /\bEAI_AGAIN\b/,
  /\bsocket hang up\b/i,
];

/**
 * Judge a provider error. Unrecognized failures are terminal on
 * purpose: an unknown error repeated three times is still unknown, and
 * the delay only postpones the diagnosis.
 */
export function classifyFailure(err: unknown): FailureKind {
  const status = statusOf(err);
  if (status !== undefined) {
    if (TRANSIENT_STATUSES.has(status)) return "transient";
    if (TERMINAL_STATUSES.has(status)) return "terminal";
    return status >= 500 ? "transient" : "terminal";
  }

  const message = err instanceof Error ? err.message : String(err);
  // Three tiers, most specific first. Throughput rejections often name
  // the credential, so they are matched ahead of the generic terminal
  // wording; terminal then wins over the remaining transient patterns,
  // so "authentication timed out" stays an auth failure.
  if (RETRYABLE_FIRST_PATTERNS.some((p) => p.test(message))) return "transient";
  if (TERMINAL_PATTERNS.some((p) => p.test(message))) return "terminal";
  if (TRANSIENT_PATTERNS.some((p) => p.test(message))) return "transient";
  return "terminal";
}

/** The provider SDKs surface HTTP status on the error; shapes vary. */
function statusOf(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const obj = err as Record<string, unknown>;
  for (const key of ["status", "statusCode"]) {
    const value = obj[key];
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  const response = obj["response"];
  if (typeof response === "object" && response !== null) {
    const value = (response as Record<string, unknown>)["status"];
    if (typeof value === "number" && Number.isInteger(value)) return value;
  }
  return undefined;
}

/** The outcome of a retried call: the value, or the failure that stuck. */
export type RetryResult<T> =
  | { readonly ok: true; readonly value: T; readonly attempts: number; }
  | {
    readonly ok: false;
    readonly error: Error;
    readonly kind: FailureKind;
    readonly attempts: number;
  };

/**
 * Run `operation`, retrying transient failures with exponential backoff.
 * Never throws -- the caller decides what a stuck failure means, which
 * in the eval lane is "exclude this sample", not "score it zero".
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options?: RetryOptions,
): Promise<RetryResult<T>> {
  const maxAttempts = options?.attempts ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1000;
  const sleep = options?.sleep ?? defaultSleep;

  let attempts = 0;
  let lastError: Error = new Error("no attempt was made");
  let lastKind: FailureKind = "terminal";

  while (attempts < maxAttempts) {
    attempts++;
    try {
      return { ok: true, value: await operation(), attempts };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      lastKind = classifyFailure(err);
      if (lastKind === "terminal" || attempts >= maxAttempts) break;
      await sleep(baseDelayMs * 2 ** (attempts - 1));
    }
  }

  return { ok: false, error: lastError, kind: lastKind, attempts };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
