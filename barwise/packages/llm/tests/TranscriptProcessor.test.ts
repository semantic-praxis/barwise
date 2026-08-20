/**
 * Tests for the TranscriptProcessor, which orchestrates the LLM extraction
 * pipeline: transcript -> prompt -> LLM call -> parsed OrmModel.
 *
 * These tests use a mock LlmClient that returns pre-recorded fixture
 * responses, so they run without a real LLM. They verify:
 *   - End-to-end extraction (object types, fact types, constraints, ambiguities)
 *   - Provenance tracking (which transcript lines support each element)
 *   - Constraint application with confidence filtering
 *   - Error handling (empty transcript, malformed JSON response)
 *   - parseExtractionFromJson for offline replay of saved responses
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CompletionRequest, LlmClient } from "../src/LlmClient.js";
import { parseExtractionFromJson, processTranscript } from "../src/TranscriptProcessor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "fixtures");

function loadFixture(path: string): string {
  return readFileSync(resolve(fixturesDir, path), "utf-8");
}

/**
 * A mock LlmClient that returns a pre-recorded response fixture.
 */
function createMockClient(responseJson: string): LlmClient {
  return {
    provider: "test",
    model: undefined,
    async complete(_request: CompletionRequest) {
      return { content: responseJson };
    },
  };
}

describe("TranscriptProcessor", () => {
  describe("processTranscript", () => {
    it("processes order-management transcript end-to-end", async () => {
      const transcript = loadFixture("transcripts/order-management.md");
      const response = loadFixture("responses/order-management.json");
      const client = createMockClient(response);

      const result = await processTranscript(transcript, client, {
        modelName: "Order Management",
      });

      // Should have extracted 5 object types.
      expect(result.model.objectTypes).toHaveLength(5);
      expect(result.model.getObjectTypeByName("Customer")).toBeDefined();
      expect(result.model.getObjectTypeByName("Order")).toBeDefined();
      expect(result.model.getObjectTypeByName("Product")).toBeDefined();
      expect(result.model.getObjectTypeByName("OrderStatus")).toBeDefined();
      expect(result.model.getObjectTypeByName("Name")).toBeDefined();

      // Should have extracted 4 fact types.
      expect(result.model.factTypes).toHaveLength(4);
      expect(
        result.model.getFactTypeByName("Customer places Order"),
      ).toBeDefined();
      expect(
        result.model.getFactTypeByName("Order contains Product"),
      ).toBeDefined();

      // Should have provenance for all elements.
      expect(result.objectTypeProvenance).toHaveLength(5);
      expect(result.factTypeProvenance).toHaveLength(4);

      // Should have constraint provenance entries.
      expect(result.constraintProvenance.length).toBeGreaterThan(0);

      // Should have identified the customer/client ambiguity.
      expect(result.ambiguities).toHaveLength(1);
      expect(result.ambiguities[0]?.description).toContain("client");
    });

    it("passes system prompt and user message to the client", async () => {
      let capturedRequest: CompletionRequest | undefined;
      const client: LlmClient = {
        provider: "test",
        model: undefined,
        async complete(request: CompletionRequest) {
          capturedRequest = request;
          return {
            content: JSON.stringify({
              object_types: [],
              fact_types: [],
              inferred_constraints: [],
              ambiguities: [],
            }),
          };
        },
      };

      await processTranscript("Some transcript text", client);

      expect(capturedRequest).toBeDefined();
      expect(capturedRequest!.systemPrompt).toContain("ORM");
      expect(capturedRequest!.userMessage).toContain("Some transcript text");
      expect(capturedRequest!.responseSchema).toBeDefined();
    });

    it("throws on empty transcript", async () => {
      const client = createMockClient("{}");
      await expect(processTranscript("", client)).rejects.toThrow("empty");
    });

    it("throws on malformed LLM response", async () => {
      const client: LlmClient = {
        provider: "test",
        model: undefined,
        async complete() {
          return { content: "not json at all" };
        },
      };

      await expect(
        processTranscript("Some text", client),
      ).rejects.toThrow("Failed to parse");
    });

    it("uses default model name when not specified", async () => {
      const response = JSON.stringify({
        object_types: [],
        fact_types: [],
        inferred_constraints: [],
        ambiguities: [],
      });
      const client = createMockClient(response);

      const result = await processTranscript("Some text", client);
      expect(result.model.name).toBe("Extracted Model");
    });

    it("propagates modelUsed from client response to result", async () => {
      const client: LlmClient = {
        provider: "test",
        model: undefined,
        async complete(_request: CompletionRequest) {
          return {
            content: JSON.stringify({
              object_types: [],
              fact_types: [],
              inferred_constraints: [],
              ambiguities: [],
            }),
            modelUsed: "gpt-5-mini",
          };
        },
      };

      const result = await processTranscript("Some text", client);
      expect(result.modelUsed).toBe("gpt-5-mini");
    });

    it("modelUsed is undefined when client does not report it", async () => {
      const response = JSON.stringify({
        object_types: [],
        fact_types: [],
        inferred_constraints: [],
        ambiguities: [],
      });
      const client = createMockClient(response);

      const result = await processTranscript("Some text", client);
      expect(result.modelUsed).toBeUndefined();
    });
  });

  describe("parseExtractionFromJson", () => {
    it("parses a saved extraction response without LLM call", () => {
      const response = loadFixture("responses/order-management.json");
      const result = parseExtractionFromJson(response, "Replayed Model");

      expect(result.model.name).toBe("Replayed Model");
      expect(result.model.objectTypes).toHaveLength(5);
      expect(result.model.factTypes).toHaveLength(4);
    });

    it("throws on invalid JSON", () => {
      expect(() => parseExtractionFromJson("{{bad json", "Test")).toThrow();
    });
  });

  describe("subtype extraction from fixture", () => {
    it("extracts subtypes from employee-hierarchy fixture", () => {
      const response = loadFixture("responses/employee-hierarchy.json");
      const result = parseExtractionFromJson(response, "Employee Hierarchy");

      expect(result.model.objectTypes).toHaveLength(5);
      expect(result.model.subtypeFacts).toHaveLength(2);
      expect(result.subtypeProvenance).toHaveLength(2);
      expect(result.subtypeProvenance.every((sp) => sp.applied)).toBe(true);

      // Employee -> Person (provides_identification = false)
      const empSubtype = result.model.subtypeFacts.find((sf) => {
        const sub = result.model.getObjectType(sf.subtypeId);
        return sub?.name === "Employee";
      });
      expect(empSubtype).toBeDefined();
      expect(empSubtype!.providesIdentification).toBe(false);

      // Manager -> Employee (provides_identification = true, default)
      const mgrSubtype = result.model.subtypeFacts.find((sf) => {
        const sub = result.model.getObjectType(sf.subtypeId);
        return sub?.name === "Manager";
      });
      expect(mgrSubtype).toBeDefined();
      expect(mgrSubtype!.providesIdentification).toBe(true);
    });
  });

  describe("constraint verification on fixture", () => {
    it("applies high-confidence constraints from the fixture", () => {
      const response = loadFixture("responses/order-management.json");
      const result = parseExtractionFromJson(response, "Test");

      // The fixture has constraints on "Customer places Order".
      const ft = result.model.getFactTypeByName("Customer places Order");
      expect(ft).toBeDefined();

      // Should have at least one uniqueness and one mandatory.
      const hasUniqueness = ft!.constraints.some(
        (c) => c.type === "internal_uniqueness",
      );
      const hasMandatory = ft!.constraints.some(
        (c) => c.type === "mandatory",
      );
      expect(hasUniqueness).toBe(true);
      expect(hasMandatory).toBe(true);

      // All applied constraints should be tracked in provenance.
      const applied = result.constraintProvenance.filter((cp) => cp.applied);
      expect(applied.length).toBeGreaterThan(0);

      // All applied constraints from the fixture are high or medium confidence.
      for (const cp of applied) {
        expect(["high", "medium"]).toContain(cp.confidence);
      }
    });

    it("propagates data_type from fixture to model", () => {
      const response = loadFixture("responses/order-management.json");
      const result = parseExtractionFromJson(response, "Test");

      const nameOt = result.model.getObjectTypeByName("Name");
      expect(nameOt).toBeDefined();
      expect(nameOt!.dataType).toEqual({ name: "text", length: 100 });
    });

    it("propagates is_preferred from fixture to model", () => {
      const response = loadFixture("responses/order-management.json");
      const result = parseExtractionFromJson(response, "Test");

      const ft = result.model.getFactTypeByName("Customer has Name");
      expect(ft).toBeDefined();
      const uc = ft!.constraints.find((c) => c.type === "internal_uniqueness");
      expect(uc).toBeDefined();
      expect(uc!.type === "internal_uniqueness" && uc!.isPreferred).toBe(true);
    });

    it("records source references on provenance entries", () => {
      const response = loadFixture("responses/order-management.json");
      const result = parseExtractionFromJson(response, "Test");

      // Object type provenance should have source references.
      const customerProv = result.objectTypeProvenance.find(
        (p) => p.elementName === "Customer",
      );
      expect(customerProv).toBeDefined();
      expect(customerProv!.sourceReferences.length).toBeGreaterThan(0);
      expect(customerProv!.sourceReferences[0]?.excerpt).toBeTruthy();
    });
  });
});
