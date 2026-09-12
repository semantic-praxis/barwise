/**
 * An `LlmClient` that borrows the MCP client's model instead of a key.
 *
 * The MCP server needed `ANTHROPIC_API_KEY` while the VS Code surface needed
 * nothing: `CopilotLlmClient` there implements the same `LlmClient` interface
 * over `vscode.lm`, so the host supplies the model. MCP's protocol-native
 * equivalent is **sampling** -- the server asks the client to run the
 * completion -- and this is that client
 * (docs/specs/keyless-model-access.spec.md, barwise-1030).
 *
 * It lives in `@barwise/mcp` rather than `@barwise/llm` for the same reason
 * `CopilotLlmClient` lives in the vscode package: the one-way dependency
 * graph keeps `llm` free of both the `vscode` module and the MCP SDK. A
 * host-backed client belongs with its host adapter.
 *
 * **Not usable by promptlab, and that is structural rather than a gap.**
 * `model` is `undefined` because the client chooses, so prompt-variant
 * resolution has nothing to resolve against and a recorded `promptHash`
 * would not be a function of the model that answered. `CopilotLlmClient`
 * carries the same caveat in the same words.
 */
import type { CompletionRequest, CompletionResponse, LlmClient } from "@barwise/llm";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

/**
 * Matches the Anthropic client's own default, so switching a surface from a
 * key to sampling does not silently change the answer budget.
 */
const DEFAULT_MAX_TOKENS = 8192;

/** The tool name a structured request is asked for under. */
const STRUCTURED_TOOL = "emit_structured_result";

export class SamplingLlmClient implements LlmClient {
  readonly provider = "mcp-sampling";

  constructor(private readonly server: Server) {}

  /**
   * Always `undefined`: the MCP client picks the model, and says which one it
   * used only afterwards (`CreateMessageResult.model`, surfaced as
   * `modelUsed`). Reporting a guess here would make variant resolution pick a
   * prompt for a model that never ran.
   */
  get model(): string | undefined {
    return undefined;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const structured = request.responseSchema !== undefined;

    const start = Date.now();
    const result = await this.server.createMessage({
      ...(request.systemPrompt !== "" ? { systemPrompt: request.systemPrompt } : {}),
      messages: [
        { role: "user", content: { type: "text", text: request.userMessage } },
      ],
      maxTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(structured
        ? {
          tools: [{
            name: STRUCTURED_TOOL,
            description: "Return the result as structured JSON matching the input schema.",
            // The schema is a JSON Schema object either way; the SDK types
            // it more narrowly than `Record<string, unknown>`, and casting
            // here is narrower than widening CompletionRequest for one
            // consumer.
            inputSchema: request.responseSchema as { type: "object"; },
          }],
          // "required", matching CopilotLlmClient's Required tool mode: the
          // caller asked for structured output, so a prose answer is a
          // failure rather than an alternative.
          toolChoice: { mode: "required" as const },
        }
        : {}),
    });
    const latencyMs = Date.now() - start;

    const content = extractContent(result.content, structured);
    return {
      content,
      ...(result.model !== "" ? { modelUsed: result.model } : {}),
      latencyMs,
    };
  }
}

/**
 * The answer, from one content block or several.
 *
 * `CreateMessageResult` extends `SamplingMessage`, whose `content` is a
 * single block OR an array -- so a reader that assumed either shape would
 * work against some clients and not others.
 */
function extractContent(
  content: unknown,
  structured: boolean,
): string {
  const blocks = Array.isArray(content) ? content : [content];

  if (structured) {
    for (const block of blocks) {
      if (isToolUse(block)) return JSON.stringify(block.input);
    }
    // The client was asked for `toolChoice: required` and returned prose
    // anyway. Returning the text would hand the parser something it cannot
    // read and produce a confusing downstream error; say what happened here.
    throw new Error(
      "MCP sampling returned no tool_use block for a structured request. "
        + "The client may not honour toolChoice: required.",
    );
  }

  return blocks
    .filter((b): b is { type: "text"; text: string; } => isText(b))
    .map((b) => b.text)
    .join("");
}

function isToolUse(block: unknown): block is { type: "tool_use"; input: unknown; } {
  return typeof block === "object" && block !== null
    && (block as { type?: unknown; }).type === "tool_use";
}

function isText(block: unknown): block is { type: "text"; text: string; } {
  return typeof block === "object" && block !== null
    && (block as { type?: unknown; }).type === "text"
    && typeof (block as { text?: unknown; }).text === "string";
}
