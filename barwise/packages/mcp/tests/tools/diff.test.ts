/**
 * Tests for the diff_models tool.
 */
import { ELEMENT_MATCHINGS } from "@barwise/core/diff";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { executeDiff, registerDiffTool } from "../../src/tools/diff.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");

describe("diff_models tool", () => {
  it("reports no changes for identical models", () => {
    const result = executeDiff(
      `${fixtures}/simple.orm.yaml`,
      `${fixtures}/simple.orm.yaml`,
    );
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.hasChanges).toBe(false);
    expect(parsed.deltas).toHaveLength(0);
  });

  it("reports changes between different models", () => {
    const result = executeDiff(
      `${fixtures}/simple.orm.yaml`,
      `${fixtures}/simple-modified.orm.yaml`,
    );
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.hasChanges).toBe(true);
    expect(parsed.deltas.length).toBeGreaterThan(0);
  });

  it("includes delta details with kind and breakingLevel", () => {
    const result = executeDiff(
      `${fixtures}/simple.orm.yaml`,
      `${fixtures}/simple-modified.orm.yaml`,
    );
    const parsed = JSON.parse(result.content[0]!.text);
    for (const delta of parsed.deltas) {
      expect(delta).toHaveProperty("kind");
      expect(delta).toHaveProperty("elementType");
      expect(delta).toHaveProperty("breakingLevel");
    }
  });

  it("returns synonym candidates", () => {
    const result = executeDiff(
      `${fixtures}/simple.orm.yaml`,
      `${fixtures}/simple-modified.orm.yaml`,
    );
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("synonymCandidates");
  });

  it("returns content in MCP format", () => {
    const result = executeDiff(
      `${fixtures}/simple.orm.yaml`,
      `${fixtures}/simple.orm.yaml`,
    );
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");
  });

  it("reports a definition delta labelled by its term (not `name`)", () => {
    const base = `
orm_version: "1.0"
model:
  name: Glossary Model
  object_types:
    - id: ot-a
      name: A
      kind: entity
      reference_mode: a_id
  definitions:
    - term: Widget
      definition: A thing sold in the store.
`;
    const incoming = `
orm_version: "1.0"
model:
  name: Glossary Model
  object_types:
    - id: ot-a
      name: A
      kind: entity
      reference_mode: a_id
  definitions:
    - term: Widget
      definition: A physical thing sold in the store.
`;
    const result = executeDiff(base, incoming);
    const parsed = JSON.parse(result.content[0]!.text);
    const definitionDelta = parsed.deltas.find(
      (d: { elementType: string; }) => d.elementType === "definition",
    );
    expect(definitionDelta).toBeDefined();
    expect(definitionDelta.name).toBe("Widget");
    // The same shape as the CLI's JSON, structured changes included: both
    // surfaces serialize through core's deltaToJson.
    expect(definitionDelta.changes).toEqual([
      {
        change: "definitionText",
        from: "A thing sold in the store.",
        to: "A physical thing sold in the store.",
      },
    ]);
  });

  it("accepts file-object base and incoming", () => {
    const result = executeDiff(
      { path: `${fixtures}/simple.orm.yaml` },
      { path: `${fixtures}/simple-modified.orm.yaml` },
    );
    expect(JSON.parse(result.content[0]!.text).hasChanges).toBe(true);
  });
});

describe("diff_models matching", () => {
  // Two samples that numbered their object types in their own order, so
  // `ot0` is Dog in one and Cat in the other (barwise-uy7).
  const a =
    'orm_version: "3.0"\nmodel:\n  name: S\n  object_types:\n    - { id: ot0, name: Dog, kind: value }\n    - { id: ot1, name: Cat, kind: value }\n';
  const b =
    'orm_version: "3.0"\nmodel:\n  name: S\n  object_types:\n    - { id: ot0, name: Cat, kind: value }\n    - { id: ot1, name: Dog, kind: value }\n';
  const changed = (matching?: "id-first" | "content") =>
    JSON.parse(executeDiff(a, b, matching).content[0]!.text).deltas.length;

  it("pairs by id by default, so the swap reads as two renames", () => {
    expect(changed()).toBe(2);
    expect(changed("id-first")).toBe(2);
  });

  it("pairs by name under content matching, so nothing changed", () => {
    expect(changed("content")).toBe(0);
  });
});

describe("diff_models handler", () => {
  // From the retroactive review of #735: the tests called executeDiff
  // directly, so dropping `matching` in the registered handler went unseen.
  it("passes matching through to the diff", async () => {
    let definition: {
      inputSchema: Record<string, { safeParse: (v: unknown) => { success: boolean; }; }>;
    } | undefined;
    let handler:
      | ((args: Record<string, unknown>) => Promise<{ content: { text: string; }[]; }>)
      | undefined;
    const server = {
      registerTool: (_name: string, d: typeof definition, h: typeof handler) => {
        definition = d;
        handler = h;
      },
    };
    registerDiffTool(server as never);
    const a =
      'orm_version: "3.0"\nmodel:\n  name: S\n  object_types:\n    - { id: ot0, name: Dog, kind: value }\n    - { id: ot1, name: Cat, kind: value }\n';
    const b =
      'orm_version: "3.0"\nmodel:\n  name: S\n  object_types:\n    - { id: ot0, name: Cat, kind: value }\n    - { id: ot1, name: Dog, kind: value }\n';
    const deltas = async (matching?: string) =>
      JSON.parse((await handler!({ base: a, incoming: b, matching })).content[0]!.text).deltas
        .length;
    expect(await deltas()).toBe(2);
    expect(await deltas("content")).toBe(0);
    // The handler is called directly above, so the schema a client's
    // arguments meet is asserted on its own.
    const matching = definition!.inputSchema.matching!;
    expect([...ELEMENT_MATCHINGS, undefined].map((m) => matching.safeParse(m).success))
      .toEqual([true, true, true]);
    expect(matching.safeParse("fuzzy").success).toBe(false);
  });
});

describe("diff_models renames (iri-identity 6a)", () => {
  const shop = (p: string, customer: string, places: string, role: string) =>
    `orm_version: "3.0"
model:
  name: Shop
  object_types:
    - { id: ${p}c, name: ${customer}, kind: entity, reference_mode: nr }
    - { id: ${p}o, name: Order, kind: entity, reference_mode: nr }
  fact_types:
    - id: ${p}f
      name: ${places}
      roles:
        - { id: ${p}r0, player: ${p}c, role_name: ${role} }
        - { id: ${p}r1, player: ${p}o, role_name: placed by }
      readings: ["{0} ${role} {1}"]
`;
  const run = (...args: Parameters<typeof executeDiff>) =>
    JSON.parse(executeDiff(...args).content[0]!.text);

  it("marks a recognized rename", () => {
    const result = run(
      shop("a", "Customer", "Customer places Order", "places"),
      shop("b", "Client", "Customer places Order", "places"),
    );
    expect(result.deltas).toContainEqual(
      expect.objectContaining({ name: "Customer", pairedBy: "recognized" }),
    );
  });

  it("pairs a declared rename", () => {
    const result = run(
      shop("a", "Customer", "Customer places Order", "places"),
      shop("b", "Customer", "Customer submits Order", "submits"),
      undefined,
      [{ kind: "factType", from: "Customer places Order", to: "Customer submits Order" }],
    );
    expect(result.deltas).toContainEqual(
      expect.objectContaining({ elementType: "fact_type", pairedBy: "declared" }),
    );
  });
});
