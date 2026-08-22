/**
 * Ollama provider for the LlmClient interface.
 *
 * Talks to Ollama's native `/api/chat` over `fetch`, not to its
 * OpenAI-compatible `/v1` endpoint. Two things the compatible endpoint
 * cannot express, and both of them are load-bearing here:
 *
 * - **Context window.** Ollama defaults to a 4,096-token context and
 *   silently drops whatever does not fit. The extraction system prompt
 *   alone is about 4,540 tokens, so on the default the *instructions*
 *   are truncated before the transcript is read, and the model is then
 *   scored on a prompt it never saw. `num_ctx` is the only fix, and
 *   Ollama's own docs say the OpenAI API has no way to set it:
 *   the documented workarounds are a Modelfile or a server-wide
 *   `OLLAMA_CONTEXT_LENGTH`, neither reachable from a library.
 * - **Structured output.** The native `format` field takes a JSON
 *   Schema directly, where the compatible endpoint needs the
 *   `response_format.json_schema` wrapper and its `strict` flag.
 *
 * Every call streams, for the same reason the Anthropic provider does
 * and more acutely: a local model generating tens of thousands of
 * tokens can run for many minutes, and a non-streaming request sends
 * no headers until it finishes -- straight past Node's 300-second
 * header timeout. Nothing renders these tokens; streaming is purely
 * what keeps a long generation from failing as a timeout.
 *
 * No SDK, so nothing to import lazily: `fetch` is in Node core. This
 * provider is therefore the one that adds no dependency at all.
 */

import { suggestContextWindow } from "../budget.js";
import type { CompletionRequest, CompletionResponse, LlmClient } from "../LlmClient.js";
import { describeOpenAiStop } from "./stopReason.js";

export interface OllamaClientOptions {
  /** Ollama server URL. Defaults to "http://localhost:11434". */
  readonly baseUrl?: string;
  /** Model to use. Defaults to "llama3.1". */
  readonly model?: string;
  /** Maximum tokens for the response. Defaults to 8192. */
  readonly maxTokens?: number;
  /**
   * Context window in tokens (`num_ctx`), covering prompt *and*
   * response together.
   *
   * Omitted, one is derived per call from the prompt's own length plus
   * the output budget. Set it when the model or the machine cannot
   * afford the derived size -- a large window costs memory, and Ollama
   * will happily try to allocate one the hardware cannot hold.
   */
  readonly contextWindow?: number;
}

/** The subset of Ollama's `/api/chat` response this provider reads. */
interface OllamaChatChunk {
  readonly message?: { readonly content?: string; };
  readonly done?: boolean;
  readonly done_reason?: string;
  readonly prompt_eval_count?: number;
  readonly eval_count?: number;
}

/**
 * LlmClient implementation using a local Ollama server.
 */
export class OllamaLlmClient implements LlmClient {
  readonly provider = "ollama";
  /** Resolved at construction, so a prompt variant can be chosen before the call. */
  readonly model: string;
  private readonly baseUrl: string;
  private readonly maxTokens: number;
  private readonly contextWindow?: number;

  constructor(options?: OllamaClientOptions) {
    this.baseUrl = (options?.baseUrl ?? "http://localhost:11434").replace(/\/+$/, "");
    this.model = options?.model ?? "llama3.1";
    this.maxTokens = options?.maxTokens ?? 8192;
    if (options?.contextWindow !== undefined) this.contextWindow = options.contextWindow;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const numPredict = request.maxTokens ?? this.maxTokens;
    const numCtx = this.contextWindow
      ?? suggestContextWindow(
        request.systemPrompt.length + request.userMessage.length,
        numPredict,
      );

    const body: Record<string, unknown> = {
      model: this.model,
      stream: true,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userMessage },
      ],
      options: { num_ctx: numCtx, num_predict: numPredict },
      // The native field takes the schema itself. Absent for a plain
      // text completion, which is what leaving it off means.
      ...(request.responseSchema !== undefined ? { format: request.responseSchema } : {}),
    };

    const start = Date.now();
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // The status rides on the error so the eval lane's retry
      // classifier can tell a model that is still loading from one that
      // does not exist -- it reads `status` off whatever is thrown.
      const detail = await response.text().catch(() => "");
      throw Object.assign(
        new Error(
          `Ollama request failed: ${response.status} ${response.statusText}`
            + (detail ? ` -- ${detail.slice(0, 500)}` : ""),
        ),
        { status: response.status },
      );
    }

    const chunk = await readChatStream(response);
    const latencyMs = Date.now() - start;

    return {
      // Native structured output returns bare JSON, but some models
      // still fence it. Kept from the previous implementation because
      // the failure it prevents has been seen in the wild.
      content: extractJson(chunk.content),
      modelUsed: this.model,
      ...(chunk.promptTokens !== undefined || chunk.completionTokens !== undefined
        ? {
          usage: {
            ...(chunk.promptTokens !== undefined ? { promptTokens: chunk.promptTokens } : {}),
            ...(chunk.completionTokens !== undefined
              ? { completionTokens: chunk.completionTokens }
              : {}),
          },
        }
        : {}),
      latencyMs,
      // Ollama's `done_reason` uses the same vocabulary as OpenAI's
      // `finish_reason` -- "stop" when it finished, "length" when it hit
      // num_predict or exhausted the context -- so the same mapping
      // applies. An empty reason stays absent rather than becoming
      // "not truncated".
      ...describeOpenAiStop(emptyToUndefined(chunk.doneReason)),
    };
  }
}

interface StreamedChat {
  readonly content: string;
  readonly doneReason?: string;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
}

/**
 * Accumulate Ollama's newline-delimited JSON stream.
 *
 * Each line is a complete JSON object carrying one content fragment;
 * the final one has `done: true` and the counts. Lines can be split
 * across network chunks, so the tail is carried forward rather than
 * parsed -- assuming a chunk boundary falls on a newline works right up
 * until a long generation, which is exactly when it matters.
 */
async function readChatStream(response: Response): Promise<StreamedChat> {
  if (!response.body) throw new Error("Ollama returned no response body.");

  const decoder = new TextDecoder();
  let buffered = "";
  let content = "";
  let doneReason: string | undefined;
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;

  const take = (line: string): void => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let chunk: OllamaChatChunk;
    try {
      chunk = JSON.parse(trimmed) as OllamaChatChunk;
    } catch {
      // A line that is not JSON is not recoverable context; skipping it
      // loses one fragment rather than the whole generation.
      return;
    }
    if (chunk.message?.content !== undefined) content += chunk.message.content;
    if (chunk.done_reason !== undefined) doneReason = chunk.done_reason;
    if (chunk.prompt_eval_count !== undefined) promptTokens = chunk.prompt_eval_count;
    if (chunk.eval_count !== undefined) completionTokens = chunk.eval_count;
  };

  for await (const bytes of response.body as AsyncIterable<Uint8Array>) {
    buffered += decoder.decode(bytes, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) take(line);
  }
  take(buffered);

  return {
    content,
    ...(doneReason !== undefined ? { doneReason } : {}),
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(completionTokens !== undefined ? { completionTokens } : {}),
  };
}

/**
 * Ollama writes `done_reason: ""` in some paths. An empty string is not
 * a reason, and passing it through would report a stop reason of "" --
 * worse than reporting none, because it looks like an answer.
 */
function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

/**
 * Extract JSON from a response that may be wrapped in markdown
 * code fences (```json ... ```). Returns the input unchanged if
 * no fences are found.
 */
export function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  return fenceMatch ? fenceMatch[1]!.trim() : text;
}
