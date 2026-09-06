/**
 * Tests for the diff_models tool.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { executeDiff } from "../../src/tools/diff.js";

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
  });

  it("accepts file-object base and incoming", () => {
    const result = executeDiff(
      { path: `${fixtures}/simple.orm.yaml` },
      { path: `${fixtures}/simple-modified.orm.yaml` },
    );
    expect(JSON.parse(result.content[0]!.text).hasChanges).toBe(true);
  });
});
