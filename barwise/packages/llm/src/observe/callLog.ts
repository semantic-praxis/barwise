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
import { hashPrompt } from "../prompt/promptHash.js";

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
  /**
   * Fingerprint of the system prompt this call sent
   * (docs/specs/artifact-resolution-parity.spec.md, workstream 2).
   *
   * The system prompt only, never the user message. That is the rule
   * about content applied rather than bent: the system prompt is
   * authored in this repository, and the user message is the
   * transcript or model a client handed us. A digest is not readable
   * text, but hashing client material would still be recording it,
   * and the line is worth keeping where nobody has to argue about it.
   *
   * `artifactVersion` is deliberately absent. It is a hand-maintained
   * string that can be edited without being bumped; this is derived
   * from the bytes and cannot. With production resolving over
   * `builtinArtifacts` alone, the version is recoverable anyway --
   * `barwise prompt artifact` renders the shipped set offline and
   * prints each one's hash, so a row here joins back to a readable
   * prompt without this package storing a claim it cannot check.
   */
  readonly promptHash?: string;
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
      // Computed once, and used on both paths: a failed call sent a
      // prompt too, and "which prompt was I sending when the retries
      // started" is a question a log of successes cannot answer.
      const promptHash = hashPrompt(request.systemPrompt);
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
          promptHash,
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
          promptHash,
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
