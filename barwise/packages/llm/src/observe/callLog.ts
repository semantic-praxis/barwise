/**
 * A record of what a completion cost
 * (docs/specs/llm-call-observability.spec.md, workstream 1).
 *
 * Every provider already reports `modelUsed`, token counts, and
 * latency; until now every surface dropped them. This is somewhere to
 * put them, without any call site changing.
 *
 * The seam is the client, not the caller. `processTranscript`,
 * `reviewModel`, and `runSuite` would each need the same recording code
 * otherwise -- three copies today and four tomorrow, which is how the
 * divergences this project keeps finding get started. Wrapping the
 * client instead means none of them change at all.
 *
 * Records carry sizes and identities, never prompt or response text.
 * Transcripts are client material, and a telemetry log that quietly
 * accumulated the ones users feed it would be that mistake written to
 * disk and forgotten.
 */

import type { CompletionRequest, CompletionResponse, LlmClient } from "../LlmClient.js";

export interface LlmCallRecord {
  /** Caller-supplied, because this package reads no clock. */
  readonly startedAt: string;
  readonly provider: string;
  /** What the client meant to use; absent when it could not know. */
  readonly model: string | undefined;
  /** What actually answered, when the provider says. */
  readonly modelUsed?: string;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly latencyMs?: number;
  readonly ok: boolean;
  /**
   * A classification, never the provider's message. Error strings can
   * carry request context, and a log accumulating them would drift back
   * toward recording content.
   */
  readonly errorKind?: string;
  /** Groups the calls of one operation -- an eval sweep, say. */
  readonly correlationId?: string;
}

export interface CallLogSink {
  record(entry: LlmCallRecord): void;
}

export interface CallLogOptions {
  readonly correlationId?: string;
  /** Injected so this package keeps its no-clocks rule. */
  readonly now?: () => string;
}

/**
 * Wrap a client so every completion through it is recorded.
 *
 * The wrapped client is indistinguishable from the original to its
 * caller: the same response comes back, the same errors are thrown at
 * the same time. A sink that throws is swallowed -- observability that
 * can fail the operation it observes is worse than none.
 */
export function withCallLog(
  client: LlmClient,
  sink: CallLogSink,
  options?: CallLogOptions,
): LlmClient {
  const now = options?.now ?? (() => new Date().toISOString());
  const correlation = options?.correlationId !== undefined
    ? { correlationId: options.correlationId }
    : {};

  const emit = (entry: LlmCallRecord): void => {
    try {
      sink.record(entry);
    } catch {
      // Deliberately silent. A broken sink must not turn a completed
      // call into a failed one, and must not print noise into the
      // middle of a command's real output.
    }
  };

  return {
    provider: client.provider,
    model: client.model,
    async complete(request: CompletionRequest): Promise<CompletionResponse> {
      const startedAt = now();
      try {
        const response = await client.complete(request);
        emit({
          startedAt,
          provider: client.provider,
          model: client.model,
          ...(response.modelUsed !== undefined ? { modelUsed: response.modelUsed } : {}),
          ...(response.usage?.promptTokens !== undefined
            ? { promptTokens: response.usage.promptTokens }
            : {}),
          ...(response.usage?.completionTokens !== undefined
            ? { completionTokens: response.usage.completionTokens }
            : {}),
          ...(response.latencyMs !== undefined ? { latencyMs: response.latencyMs } : {}),
          ok: true,
          ...correlation,
        });
        return response;
      } catch (err) {
        // A failed call is a row, not a gap. A log that recorded only
        // successes would make a rate-limit storm look like a quiet day.
        emit({
          startedAt,
          provider: client.provider,
          model: client.model,
          ok: false,
          errorKind: classifyError(err),
          ...correlation,
        });
        throw err;
      }
    },
  };
}

/**
 * Reduce an error to a coarse class.
 *
 * Deliberately not the message. This mirrors the retry classifier in
 * `@barwise/promptlab` without importing it -- that package depends on
 * this one, and a shared vocabulary is not worth inverting the graph
 * for.
 */
function classifyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/\brate limit|\btoo many requests|\boverloaded\b|\bquota\b/i.test(message)) {
    return "rate_limit";
  }
  if (/\bapi key\b|\bauthentication\b|\bunauthorized\b|\bpermission\b/i.test(message)) {
    return "auth";
  }
  if (/\btimeout\b|\btimed out\b|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(message)) {
    return "network";
  }
  return "other";
}
