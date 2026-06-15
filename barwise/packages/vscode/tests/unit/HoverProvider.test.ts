/**
 * Unit tests for HoverProvider.
 *
 * Tests hover information generation without requiring VS Code.
 * The provider takes a TextDocument and Position from the
 * vscode-languageserver package, which we construct directly.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { HoverProvider } from "../../src/server/HoverProvider.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, "..", "fixtures", name), "utf-8");
}

function makeDocument(content: string): TextDocument {
  return TextDocument.create("file:///test/model.orm.yaml", "orm-yaml", 1, content);
}

describe("HoverProvider", () => {
  const provider = new HoverProvider();

  describe("object type hover by name", () => {
    it("returns hover with name, kind, and definition for an entity type", () => {
      const content = loadFixture("simple.orm.yaml");
      const doc = makeDocument(content);
      const lines = content.split("\n");

      // Find the line with "Customer" as a name value.
      const nameLineIdx = lines.findIndex(
        (l) => l.includes('name: "Customer"'),
      );
      expect(nameLineIdx).toBeGreaterThan(-1);

      // Position cursor on "Customer".
      const charIdx = lines[nameLineIdx]!.indexOf("Customer");
      const hover = provider.provideHover(doc, {
        line: nameLineIdx,
        character: charIdx + 2,
      });

      expect(hover).not.toBeNull();
      const markdown = (hover!.contents as { value: string; }).value;
      expect(markdown).toContain("**Customer**");
      expect(markdown).toContain("entity");
      expect(markdown).toContain("A person who places orders.");
    });

    it("includes fact types the object type participates in", () => {
      const content = loadFixture("simple.orm.yaml");
      const doc = makeDocument(content);
      const lines = content.split("\n");

      const nameLineIdx = lines.findIndex(
        (l) => l.includes('name: "Customer"'),
      );
      const charIdx = lines[nameLineIdx]!.indexOf("Customer");
      const hover = provider.provideHover(doc, {
        line: nameLineIdx,
        character: charIdx + 2,
      });

      expect(hover).not.toBeNull();
      const markdown = (hover!.contents as { value: string; }).value;
      expect(markdown).toContain("**Fact types:**");
      // The verbalization should mention "Customer" and "Name".
      expect(markdown).toContain("Customer");
      expect(markdown).toContain("Name");
    });
  });

  describe("object type hover by ID", () => {
    it("returns hover when hovering over an object type ID (player reference)", () => {
      const content = loadFixture("simple.orm.yaml");
      const doc = makeDocument(content);
      const lines = content.split("\n");

      // Find a line with player: "ot-customer".
      const playerLineIdx = lines.findIndex(
        (l) => l.includes('player: "ot-customer"'),
      );
      expect(playerLineIdx).toBeGreaterThan(-1);

      const charIdx = lines[playerLineIdx]!.indexOf("ot-customer");
      const hover = provider.provideHover(doc, {
        line: playerLineIdx,
        character: charIdx + 2,
      });

      expect(hover).not.toBeNull();
      const markdown = (hover!.contents as { value: string; }).value;
      expect(markdown).toContain("**Customer**");
      expect(markdown).toContain("entity");
    });
  });

  describe("counterexamples on hover", () => {
    function hoverCustomer(p: HoverProvider): string | null {
      const content = loadFixture("simple.orm.yaml");
      const doc = makeDocument(content);
      const lines = content.split("\n");
      const nameLineIdx = lines.findIndex((l) => l.includes('name: "Customer"'));
      const charIdx = lines[nameLineIdx]!.indexOf("Customer");
      const hover = p.provideHover(doc, { line: nameLineIdx, character: charIdx + 2 });
      return hover ? (hover.contents as { value: string; }).value : null;
    }

    it("omits the 'Rules out' section by default", () => {
      const markdown = hoverCustomer(new HoverProvider());
      expect(markdown).not.toBeNull();
      expect(markdown!).not.toContain("Rules out");
    });

    it("includes the 'Rules out' section when enabled", () => {
      const markdown = hoverCustomer(new HoverProvider(true));
      expect(markdown).not.toBeNull();
      expect(markdown!).toContain("**Rules out:**");
    });
  });

  describe("no hover", () => {
    it("returns null for an unknown word", () => {
      const content = loadFixture("simple.orm.yaml");
      const doc = makeDocument(content);

      // Line 0 has "orm_version" which is not an object type.
      const hover = provider.provideHover(doc, {
        line: 0,
        character: 0,
      });
      expect(hover).toBeNull();
    });

    it("returns null for malformed YAML", () => {
      const doc = makeDocument("{{{{not valid yaml");
      const hover = provider.provideHover(doc, {
        line: 0,
        character: 5,
      });
      expect(hover).toBeNull();
    });
  });
});
