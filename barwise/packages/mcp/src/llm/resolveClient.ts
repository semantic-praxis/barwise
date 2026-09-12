/**
 * Prefer the host's model over an API key, and say which one was used.
 *
 * The VS Code surface has done this since it shipped: `resolveLlmClient()`
 * there prefers `CopilotLlmClient` and falls back to Anthropic only when the
 * user configured a key. The MCP server had no equivalent and always needed
 * `ANTHROPIC_API_KEY`; this is the same decision, one surface over
 * (docs/specs/keyless-model-access.spec.md, barwise-1030).
 *
 * The fallback is not a formality. Sampling support is uneven across MCP
 * clients, and a server that assumed it would fail against most of them.
 */
import { createLlmClient, type LlmClient, type ProviderName } from "@barwise/llm";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SamplingLlmClient } from "./SamplingLlmClient.js";

/** Which route a completion took, so a caller can report it. */
export type LlmRoute = "sampling" | "api-key";

export interface ResolvedLlmClient {
  readonly client: LlmClient;
  readonly route: LlmRoute;
}

/**
 * `sampling.tools`, NOT `sampling`, and this is the correction grounding
 * produced.
 *
 * Both of barwise's LLM paths ask for structured output --
 * `processTranscript` builds a response schema and so does `reviewModel` --
 * so every call this server makes carries `tools`. The protocol says the
 * client MUST error when `tools` is sent without having declared
 * `sampling.tools`. Keying the decision on `sampling` alone would therefore
 * replace a working keyed path with a failing sampling one for any client
 * that supports sampling but not tool use.
 */
function clientCanSampleStructured(server: McpServer): boolean {
  return server.server.getClientCapabilities()?.sampling?.tools !== undefined;
}

/**
 * The client to use, and the route it represents.
 *
 * An explicit `provider` is honoured over sampling: an operator who passed
 * one is answering this question themselves, and silently ignoring it would
 * make `--provider ollama` mean something other than what it says.
 */
export function resolveLlmClient(
  server: McpServer,
  options?: { readonly provider?: ProviderName; readonly model?: string; },
): ResolvedLlmClient {
  if (options?.provider === undefined && clientCanSampleStructured(server)) {
    return { client: new SamplingLlmClient(server.server), route: "sampling" };
  }
  return {
    client: createLlmClient({
      ...(options?.provider !== undefined ? { provider: options.provider } : {}),
      ...(options?.model !== undefined ? { model: options.model } : {}),
    }),
    route: "api-key",
  };
}

/**
 * A line appended to a tool result saying where the model came from.
 *
 * A silent fallback to a key is the reading this whole change exists to
 * prevent: the operator would believe the server needs no credential while
 * it quietly used one.
 */
export function routeNote(route: LlmRoute, modelUsed?: string): string {
  if (route === "sampling") {
    return `\n\n_Model access: MCP sampling (no API key used)${
      modelUsed !== undefined ? `, model \`${modelUsed}\`` : ""
    }._`;
  }
  return "\n\n_Model access: this server's own API key. "
    + "An MCP client advertising `sampling.tools` would need none._";
}

/**
 * The same note, appended to a tool result's last text block.
 *
 * Beside `routeNote` rather than at each call site: two tools report this,
 * and a second copy of "which block do I append to" is a decision that would
 * have to agree with nothing checking it.
 */
export function appendRouteNote<T extends { content: Array<{ type: "text"; text: string; }>; }>(
  result: T,
  route: LlmRoute,
): T {
  const note = routeNote(route);
  const last = result.content[result.content.length - 1];
  if (last === undefined) {
    return { ...result, content: [{ type: "text" as const, text: note.trimStart() }] };
  }
  return {
    ...result,
    content: [
      ...result.content.slice(0, -1),
      { ...last, text: last.text + note },
    ],
  };
}
