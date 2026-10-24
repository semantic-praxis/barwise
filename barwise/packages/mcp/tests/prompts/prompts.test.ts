/**
 * The analyze-domain and review-model prompts (barwise-8n5).
 *
 * `serverTransport.test.ts` renders both over a real transport, but asserts
 * only that a message came back. These call each registered handler directly
 * and check what the prompt is for: that its argument reaches the text, that
 * it carries the shared guidance, and that every tool it tells the AI to run
 * is a tool this server registers -- a renamed tool otherwise leaves the
 * prompt naming something that no longer exists, and nothing fails.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { registerAnalyzeDomainPrompt } from "../../src/prompts/analyzeDomain.js";
import {
  CONTEXT_HYGIENE_GUIDANCE,
  MODELING_WORKFLOW_GUIDANCE,
  SENSEMAKING_GUIDANCE,
} from "../../src/prompts/guidance/guidance.js";
import { registerReviewModelPrompt } from "../../src/prompts/reviewModel.js";
import { registerTools } from "../../src/tools/index.js";

interface Captured {
  readonly definition: { argsSchema: Record<string, z.ZodTypeAny>; };
  readonly handler: (args: Record<string, string>) => {
    messages: { role: string; content: { type: string; text: string; }; }[];
  };
}

/** Register one prompt on a stand-in server and hand back what it registered. */
function capture(register: (server: never) => void): Captured {
  let captured: Captured | undefined;
  register({
    registerPrompt: (
      _name: string,
      definition: Captured["definition"],
      handler: Captured["handler"],
    ) => {
      captured = { definition, handler };
    },
  } as never);
  return captured!;
}

/** Every tool name the server registers. */
function registeredToolNames(): Set<string> {
  const names = new Set<string>();
  registerTools({ registerTool: (name: string) => names.add(name) } as never);
  return names;
}

/**
 * Every snake_case word a prompt mentions. Each must be a registered tool:
 * the prompts and their guidance hold no other snake_case word today, and one
 * added later fails here, to be named an exception on purpose rather than by
 * an allowlist that hides a renamed tool.
 */
function toolsNamedIn(text: string): string[] {
  return [...new Set(text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? [])];
}

describe("analyze-domain prompt", () => {
  const { definition, handler } = capture(registerAnalyzeDomainPrompt);

  it("puts the transcript last, after the guidance", () => {
    const transcript = "A customer places orders for products.";
    const [message] = handler({ transcript }).messages;
    expect(message!.role).toBe("user");
    const text = message!.content.text;
    expect(text.endsWith(`Transcript:\n${transcript}`)).toBe(true);
    for (
      const guidance of [MODELING_WORKFLOW_GUIDANCE, SENSEMAKING_GUIDANCE, CONTEXT_HYGIENE_GUIDANCE]
    ) {
      expect(text).toContain(guidance);
    }
  });

  it("requires a string transcript", () => {
    const schema = z.object(definition.argsSchema);
    expect(schema.safeParse({ transcript: "x" }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("names only tools this server registers", () => {
    const tools = registeredToolNames();
    const named = toolsNamedIn(handler({ transcript: "x" }).messages[0]!.content.text);
    expect(named.filter((n) => !tools.has(n))).toEqual([]);
    expect(named).toContain("import_transcript");
  });
});

describe("review-model prompt", () => {
  const { definition, handler } = capture(registerReviewModelPrompt);

  it("names the file under review and runs the four checks in order", () => {
    const text = handler({ filePath: "models/shop.orm.yaml" }).messages[0]!.content.text;
    expect(text).toContain("Review the ORM model at models/shop.orm.yaml");
    // Within the numbered steps: the shared guidance above them names
    // some of these tools too.
    const steps = text.slice(text.indexOf("Review the ORM model at"));
    const order = ["validate_model", "verbalize_model", "export_model", "review_model"]
      .map((tool) => steps.indexOf(tool));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const guidance of [SENSEMAKING_GUIDANCE, CONTEXT_HYGIENE_GUIDANCE]) {
      expect(text).toContain(guidance);
    }
  });

  it("requires a string filePath", () => {
    const schema = z.object(definition.argsSchema);
    expect(schema.safeParse({ filePath: "a.orm.yaml" }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("names only tools this server registers", () => {
    const tools = registeredToolNames();
    const named = toolsNamedIn(handler({ filePath: "a.orm.yaml" }).messages[0]!.content.text);
    expect(named.filter((n) => !tools.has(n))).toEqual([]);
  });
});
