/**
 * Unit tests for CompletionProvider.
 *
 * Tests completion item generation without requiring VS Code.
 * The provider takes a TextDocument and Position from the
 * vscode-languageserver package, which we construct directly.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CompletionProvider } from "../../src/server/CompletionProvider.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, "..", "fixtures", name), "utf-8");
}

function makeDocument(content: string): TextDocument {
  return TextDocument.create("file:///test/model.orm.yaml", "orm-yaml", 1, content);
}

describe("CompletionProvider", () => {
  const provider = new CompletionProvider();

  describe("player completions", () => {
    it("returns object type IDs when cursor is on a player: line", () => {
      const content = loadFixture("simple.orm.yaml");
      const doc = makeDocument(content);
      const lines = content.split("\n");

      // Find the first "player:" line.
      const playerLineIdx = lines.findIndex((l) => l.trim().startsWith("player:"));
      expect(playerLineIdx).toBeGreaterThan(-1);

      const completions = provider.provideCompletions(doc, {
        line: playerLineIdx,
        character: 10,
      });

      expect(completions.length).toBeGreaterThan(0);
      const labels = completions.map((c) => c.label);
      expect(labels).toContain("ot-customer");
      expect(labels).toContain("ot-name");
    });

    it("returns empty for a line that does not start with player:", () => {
      const doc = makeDocument(loadFixture("simple.orm.yaml"));
      const completions = provider.provideCompletions(doc, {
        line: 0, // orm_version line
        character: 0,
      });
      expect(completions).toHaveLength(0);
    });
  });

  describe("constraint type completions", () => {
    it("returns constraint types when cursor is on a type: line inside constraints", () => {
      const content = loadFixture("simple.orm.yaml");
      const doc = makeDocument(content);
      const lines = content.split("\n");

      // Find a "- type:" line (constraint type).
      const typeLineIdx = lines.findIndex((l) => l.trim().startsWith("- type:"));
      expect(typeLineIdx).toBeGreaterThan(-1);

      const completions = provider.provideCompletions(doc, {
        line: typeLineIdx,
        character: 10,
      });

      expect(completions.length).toBeGreaterThan(0);
      const labels = completions.map((c) => c.label);
      expect(labels).toContain("internal_uniqueness");
      expect(labels).toContain("mandatory");
      expect(labels).toContain("external_uniqueness");
    });
  });

  describe("kind completions", () => {
    it("returns entity and value when cursor is on a kind: line", () => {
      const content = loadFixture("simple.orm.yaml");
      const doc = makeDocument(content);
      const lines = content.split("\n");

      const kindLineIdx = lines.findIndex((l) => l.trim().startsWith("kind:"));
      expect(kindLineIdx).toBeGreaterThan(-1);

      const completions = provider.provideCompletions(doc, {
        line: kindLineIdx,
        character: 10,
      });

      expect(completions).toHaveLength(2);
      const labels = completions.map((c) => c.label);
      expect(labels).toContain("entity");
      expect(labels).toContain("value");
    });
  });

  describe("edge cases", () => {
    it("returns empty completions for unparseable YAML", () => {
      const doc = makeDocument("player: \n{{invalid");
      const completions = provider.provideCompletions(doc, {
        line: 0,
        character: 8,
      });
      // Should not throw; returns empty because YAML parsing fails.
      expect(completions).toHaveLength(0);
    });

    it("returns empty completions for a player: line when the model has no object_types", () => {
      const doc = makeDocument("player: \nmodel:\n  name: bare\n");
      const completions = provider.provideCompletions(doc, {
        line: 0,
        character: 8,
      });
      expect(completions).toHaveLength(0);
    });

    it("returns empty completions for a position past the end of the document", () => {
      const doc = makeDocument(loadFixture("simple.orm.yaml"));
      const completions = provider.provideCompletions(doc, {
        line: 9999,
        character: 0,
      });
      expect(completions).toHaveLength(0);
    });
  });
});
