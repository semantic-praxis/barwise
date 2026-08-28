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
  /**
   * Called before each backoff, so a caller can say out loud that it is
   * waiting. Without it a rate-limited sweep is indistinguishable from a
   * hung one for as long as the backoff lasts, which is exactly when an
   * operator most wants to know.
   */
  readonly onRetry?: (info: {
    readonly attempt: number;
    readonly delayMs: number;
    readonly error: Error;
  }) => void;
}

/**
 * What a failed attempt was judged to be.
 *
 * `truncated` never comes out of `classifyFailure` -- a response cut
 * off at the output ceiling is a successful call, not an exception, and
 * the runner labels it after the fact. It lives in this union anyway so
 * that everything reading `failureKind` gets the real reason instead of
 * a "terminal" that sends the operator looking for a broken credential.
 */
export type FailureKind = "transient" | "terminal" | "truncated";

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
  // undici's mid-stream connection drop is the bare message
  // "terminated" (and its cause, "other side closed"): no status, no
  // code, nothing the sets above see. Measured cost of missing it: 6
  // of 15 calls on a 2026-08-28 dev arm died unretried on ~2-minute
  // streaming responses, one case losing 4 of its 5 samples. The
  // terminal patterns still win first, so "account terminated" wording
  // from an auth failure would stay terminal.
  /\bterminated\b/i,
  /\bother side closed\b/i,
  /\bfetch failed\b/i,
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

/**
 * What the provider said about a failure, past the message.
 *
 * The message alone is a poor bug report: it is the one field the SDKs
 * reword between releases, and it never carries the request id, which
 * is the first thing a provider's support asks for and the only handle
 * on a call that has already happened. All three fields are optional
 * because a connection that never opened has none of them.
 */
export interface ProviderErrorInfo {
  readonly message: string;
  readonly status?: number;
  /** The provider's own error taxonomy, e.g. "rate_limit_error". */
  readonly errorType?: string;
  /** Provider-side identifier for the call, for support and for logs. */
  readonly requestId?: string;
}

/**
 * Pull the diagnostics off a provider error, tolerating every shape the
 * SDKs use. Deliberately forgiving: this runs while an operator is
 * looking at a failed sweep, so a field it cannot find must be absent,
 * never a thrown error on top of the one being reported.
 */
export function describeProviderError(err: unknown): ProviderErrorInfo {
  const message = err instanceof Error ? err.message : String(err);
  const status = statusOf(err);
  return {
    message,
    ...(status !== undefined ? { status } : {}),
    ...(errorTypeOf(err) !== undefined ? { errorType: errorTypeOf(err)! } : {}),
    ...(requestIdOf(err) !== undefined ? { requestId: requestIdOf(err)! } : {}),
  };
}

/**
 * Anthropic nests it under `error.error.type`; OpenAI exposes both a
 * top-level `type` and the same nested shape.
 */
function errorTypeOf(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const obj = err as Record<string, unknown>;
  const direct = obj["type"];
  if (typeof direct === "string") return direct;
  const body = obj["error"];
  if (typeof body === "object" && body !== null) {
    const nested = (body as Record<string, unknown>)["type"];
    if (typeof nested === "string") return nested;
  }
  return undefined;
}

/** Property naming differs per SDK and per major version; try them all. */
function requestIdOf(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const obj = err as Record<string, unknown>;
  for (const key of ["request_id", "requestID", "requestId"]) {
    const value = obj[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  // The header is the last resort, and the one that survives an SDK
  // that stopped surfacing the property.
  const headers = obj["headers"];
  if (typeof headers === "object" && headers !== null) {
    const get = (headers as { get?: (name: string) => unknown; }).get;
    if (typeof get === "function") {
      const value = get.call(headers, "x-request-id");
      if (typeof value === "string" && value.length > 0) return value;
    }
    const value = (headers as Record<string, unknown>)["x-request-id"];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
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
      const delayMs = baseDelayMs * 2 ** (attempts - 1);
      options?.onRetry?.({ attempt: attempts, delayMs, error: lastError });
      await sleep(delayMs);
    }
  }

  return { ok: false, error: lastError, kind: lastKind, attempts };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
