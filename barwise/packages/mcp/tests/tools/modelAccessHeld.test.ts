/**
 * Two ADR decisions held over a real MCP connection
 * (docs/specs/model-access-held.spec.md, Scope items 3 and 7).
 *
 * In-memory, client and server both real, because both decisions are about
 * what a connected client sees: whether a tool call with no key in the
 * environment reaches the client's own model, and whether a production tool's
 * input schema offers a way to send an unshipped prompt. Calling
 * `executeImport` directly would skip `resolveLlmClient`, which is the code
 * the first decision lives in.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CreateMessageRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer } from "../../src/server.js";

const here = dirname(fileURLToPath(import.meta.url));
const simple = resolve(here, "../fixtures/simple.orm.yaml");

/** Every variable a keyed provider would read; none may be set here. */
const KEY_VARS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"] as const;

/**
 * The structured answer for whichever schema the request carries: an empty
 * extraction for `import_transcript`, an empty review for `review_model`.
 * Chosen off the schema's own properties so one handler serves both tools.
 */
function answerFor(inputSchema: unknown): Record<string, unknown> {
  const props = (inputSchema as { properties?: Record<string, unknown>; }).properties ?? {};
  if ("suggestions" in props) return { suggestions: [], summary: "Nothing to add." };
  return { object_types: [], fact_types: [], inferred_constraints: [], ambiguities: [] };
}

async function connect(): Promise<{ client: Client; sampled: string[]; }> {
  const sampled: string[] = [];
  const client = new Client(
    { name: "model-access-held", version: "0.0.0" },
    // `sampling.tools`, not `sampling`: resolveLlmClient keys on exactly
    // this, because both LLM paths ask for structured output.
    { capabilities: { sampling: { tools: {} } } },
  );
  client.setRequestHandler(CreateMessageRequestSchema, (request) => {
    const tool = request.params.tools?.[0];
    sampled.push(tool?.name ?? "(no tool)");
    return {
      role: "assistant" as const,
      model: "host-model",
      content: [{
        type: "tool_use" as const,
        id: "call-1",
        name: tool?.name ?? "emit_structured_result",
        input: answerFor(tool?.inputSchema),
      }],
    };
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), createServer().connect(serverTransport)]);
  return { client, sampled };
}

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as Array<{ type: string; text?: string; }>)
    .map((b) => b.text ?? "")
    .join("\n");
}

describe("keyless defaults over MCP", () => {
  const saved = new Map<string, string | undefined>();
  let client: Client | undefined;

  beforeEach(() => {
    for (const k of KEY_VARS) {
      saved.set(k, process.env[k]);
      delete process.env[k];
    }
  });

  afterEach(async () => {
    await client?.close();
    client = undefined;
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("import_transcript with no key and no provider reaches the client's sampling handler [adr:keyless-model-access#keyless-defaults]", async () => {
    const c = await connect();
    client = c.client;

    const r = await client.callTool({
      name: "import_transcript",
      arguments: { transcript: "Each customer places orders." },
    });

    expect(c.sampled.length).toBeGreaterThan(0);
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/Model access: MCP sampling \(no API key used\)/);
  });

  it("review_model with no key and no provider reaches the client's sampling handler [adr:keyless-model-access#keyless-defaults]", async () => {
    const c = await connect();
    client = c.client;

    const r = await client.callTool({ name: "review_model", arguments: { source: simple } });

    expect(c.sampled.length).toBeGreaterThan(0);
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/Model access: MCP sampling \(no API key used\)/);
  });
});

describe("production tools offer no prompt override", () => {
  /** A property name with any of these hyphen/camel words is a candidate path. */
  const FORBIDDEN = /artifacts?|prompt|candidate/i;

  it("import_transcript and review_model input schemas carry no artifact, prompt or candidate property [adr:production-prompt-resolution#candidates-in-prompt-lane]", async () => {
    const c = await connect();
    try {
      const { tools } = await c.client.listTools();
      for (const name of ["import_transcript", "review_model"]) {
        const tool = tools.find((t) => t.name === name);
        expect(tool, name).toBeDefined();
        const props = Object.keys(tool!.inputSchema.properties ?? {});
        // Non-empty, or a schema that failed to list would pass vacuously.
        expect(props.length, name).toBeGreaterThan(0);
        expect(props.filter((p) => FORBIDDEN.test(p)), name).toEqual([]);
      }
    } finally {
      await c.client.close();
    }
  });
});
