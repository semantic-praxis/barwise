/**
 * Tests for the import_transcript tool.
 *
 * The tool wraps the LLM extraction pipeline. These tests mock
 * createLlmClient so no real API call is made -- the mock client
 * returns a canned ExtractionResponse and the rest of the pipeline
 * (processTranscript, conformance, model construction, serialization,
 * annotation) runs for real. This verifies:
 *   - Provider selection and model override reach createLlmClient
 *   - API failures and malformed responses surface as rejections
 *   - All eleven inferred constraint types, objectification, and
 *     aliases flow through to the serialized YAML output
 */
import type {
  CompletionRequest,
  CompletionResponse,
  ExtractionResponse,
  LlmClient,
} from "@barwise/llm";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeImport } from "../../src/tools/import.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");

// Mock @barwise/llm: replace createLlmClient with a stub so no real
// provider is constructed, but keep processTranscript and
// buildExistingModelContext real so extraction features flow through
// the genuine pipeline.
vi.mock("@barwise/llm", async () => {
  const actual = await vi.importActual<typeof import("@barwise/llm")>(
    "@barwise/llm",
  );
  return {
    ...actual,
    createLlmClient: vi.fn(),
  };
});

const { createLlmClient } = await import("@barwise/llm");

const TRANSCRIPT = "We track people, the projects they work on,\n"
  + "the tasks within each project, and how people manage one another.";

/**
 * Install a mock LlmClient whose complete() resolves with the given
 * extraction response. Returns the complete() mock so tests can
 * inspect the request that reached the client.
 */
function stubLlm(
  response: ExtractionResponse | string,
  extra: Partial<CompletionResponse> = {},
): ReturnType<typeof vi.fn> {
  const content = typeof response === "string"
    ? response
    : JSON.stringify(response);
  const complete = vi.fn(
    async (_request: CompletionRequest): Promise<CompletionResponse> => ({
      content,
      ...extra,
    }),
  );
  vi.mocked(createLlmClient).mockReturnValue(
    { provider: "test", model: undefined, complete } as LlmClient,
  );
  return complete;
}

/** Install a mock LlmClient whose complete() rejects, simulating an API failure. */
function stubLlmFailure(error: Error): void {
  const complete = vi.fn(async (): Promise<CompletionResponse> => {
    throw error;
  });
  vi.mocked(createLlmClient).mockReturnValue(
    { provider: "test", model: undefined, complete } as LlmClient,
  );
}

/** A minimal valid extraction response with no constraints. */
function emptyExtraction(): ExtractionResponse {
  return {
    object_types: [],
    fact_types: [],
    subtypes: [],
    inferred_constraints: [],
    ambiguities: [],
  };
}

/**
 * A comprehensive extraction response exercising every extraction
 * feature: object type aliases, all eleven inferred constraint types,
 * and an objectified fact type.
 */
function comprehensiveExtraction(): ExtractionResponse {
  return {
    object_types: [
      {
        name: "Person",
        kind: "entity",
        definition: "An individual involved in projects.",
        aliases: ["Individual", "Party"],
        source_references: [],
      },
      {
        name: "Project",
        kind: "entity",
        definition: "A unit of work staffed by people.",
        source_references: [],
      },
      {
        name: "Task",
        kind: "entity",
        definition: "A discrete work item within a project.",
        source_references: [],
      },
      {
        name: "TaskStatus",
        kind: "value",
        definition: "The lifecycle state of a task.",
        source_references: [],
      },
      {
        name: "Skill",
        kind: "entity",
        definition: "A competency a person holds.",
        source_references: [],
      },
      {
        name: "Assignment",
        kind: "entity",
        definition: "The objectified work-on relationship.",
        source_references: [],
      },
    ],
    fact_types: [
      {
        name: "Person works on Project",
        roles: [
          { player: "Person", role_name: "works on" },
          { player: "Project", role_name: "is worked on by" },
        ],
        readings: ["{0} works on {1}"],
        source_references: [],
      },
      {
        name: "Person leads Project",
        roles: [
          { player: "Person", role_name: "leads" },
          { player: "Project", role_name: "is led by" },
        ],
        readings: ["{0} leads {1}"],
        source_references: [],
      },
      {
        name: "Person manages Person",
        roles: [
          { player: "Person", role_name: "manages" },
          { player: "Person", role_name: "is managed by" },
        ],
        readings: ["{0} manages {1}"],
        source_references: [],
      },
      {
        name: "Person has Skill",
        roles: [
          { player: "Person", role_name: "has skill" },
          { player: "Skill", role_name: "is held by" },
        ],
        readings: ["{0} has skill {1}"],
        source_references: [],
      },
      {
        name: "Task has TaskStatus",
        roles: [
          { player: "Task", role_name: "has" },
          { player: "TaskStatus", role_name: "is status of" },
        ],
        readings: ["{0} has {1}"],
        source_references: [],
      },
    ],
    subtypes: [],
    inferred_constraints: [
      {
        type: "internal_uniqueness",
        fact_type: "Person works on Project",
        roles: ["Person"],
        description: "Each Person works on at most one Project.",
        confidence: "high",
        source_references: [],
      },
      {
        type: "mandatory",
        fact_type: "Person works on Project",
        roles: ["Person"],
        description: "Every Person works on some Project.",
        confidence: "high",
        source_references: [],
      },
      {
        type: "external_uniqueness",
        fact_type: "Person works on Project",
        roles: ["Project"],
        description: "Each Project is externally identified.",
        confidence: "high",
        source_references: [],
      },
      {
        type: "value_constraint",
        fact_type: "Task has TaskStatus",
        roles: ["TaskStatus"],
        values: ["Open", "InProgress", "Closed"],
        description: "Task status is one of Open, InProgress, Closed.",
        confidence: "high",
        source_references: [],
      },
      {
        type: "disjunctive_mandatory",
        fact_type: "Person leads Project",
        roles: ["Person", "Project"],
        description: "Every Person or Project participates in leadership.",
        confidence: "high",
        source_references: [],
      },
      {
        type: "exclusion",
        fact_type: "Person leads Project",
        roles: ["Person", "Project"],
        description: "Leading roles are mutually exclusive.",
        confidence: "high",
        source_references: [],
      },
      {
        type: "exclusive_or",
        fact_type: "Person leads Project",
        roles: ["Person", "Project"],
        description: "Exactly one leadership role applies.",
        confidence: "high",
        source_references: [],
      },
      {
        type: "subset",
        fact_type: "Person leads Project",
        roles: ["Person"],
        superset_fact_type: "Person works on Project",
        superset_roles: ["Person"],
        description: "A Person who leads a Project also works on a Project.",
        confidence: "high",
        source_references: [],
      },
      {
        type: "equality",
        fact_type: "Person leads Project",
        roles: ["Project"],
        superset_fact_type: "Person works on Project",
        superset_roles: ["Project"],
        description: "Led Projects and worked-on Projects coincide.",
        confidence: "high",
        source_references: [],
      },
      {
        type: "ring",
        fact_type: "Person manages Person",
        roles: ["manages", "is managed by"],
        ring_type: "irreflexive",
        description: "No Person manages themselves.",
        confidence: "high",
        source_references: [],
      },
      {
        type: "frequency",
        fact_type: "Person has Skill",
        roles: ["Person"],
        min: 1,
        max: 5,
        description: "Each Person has between one and five Skills.",
        confidence: "high",
        source_references: [],
      },
    ],
    objectified_fact_types: [
      {
        fact_type: "Person works on Project",
        object_type: "Assignment",
        description: "The work-on relationship is objectified as Assignment.",
        source_references: [],
      },
    ],
    ambiguities: [],
  };
}

describe("import_transcript tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("provider selection", () => {
    it("passes an explicit anthropic provider to createLlmClient", async () => {
      stubLlm(emptyExtraction());

      await executeImport(TRANSCRIPT, "Model", "anthropic");

      expect(createLlmClient).toHaveBeenCalledWith({
        provider: "anthropic",
        model: undefined,
      });
    });

    it("passes an explicit openai provider to createLlmClient", async () => {
      stubLlm(emptyExtraction());

      await executeImport(TRANSCRIPT, "Model", "openai");

      expect(createLlmClient).toHaveBeenCalledWith({
        provider: "openai",
        model: undefined,
      });
    });

    it("passes an explicit ollama provider to createLlmClient", async () => {
      stubLlm(emptyExtraction());

      await executeImport(TRANSCRIPT, "Model", "ollama");

      expect(createLlmClient).toHaveBeenCalledWith({
        provider: "ollama",
        model: undefined,
      });
    });

    it("passes undefined provider for auto-detection when omitted", async () => {
      stubLlm(emptyExtraction());

      await executeImport(TRANSCRIPT, "Model");

      expect(createLlmClient).toHaveBeenCalledWith({
        provider: undefined,
        model: undefined,
      });
    });
  });

  describe("model override", () => {
    it("passes the model override to createLlmClient", async () => {
      stubLlm(emptyExtraction());

      await executeImport(TRANSCRIPT, "Model", "openai", "gpt-4o");

      expect(createLlmClient).toHaveBeenCalledWith({
        provider: "openai",
        model: "gpt-4o",
      });
    });

    it("passes the model override even without an explicit provider", async () => {
      stubLlm(emptyExtraction());

      await executeImport(TRANSCRIPT, "Model", undefined, "claude-sonnet-4-5");

      expect(createLlmClient).toHaveBeenCalledWith({
        provider: undefined,
        model: "claude-sonnet-4-5",
      });
    });
  });

  describe("error handling", () => {
    it("rejects when the LLM API call fails", async () => {
      stubLlmFailure(new Error("503 Service Unavailable"));

      await expect(
        executeImport(TRANSCRIPT, "Model", "anthropic"),
      ).rejects.toThrow("503 Service Unavailable");
    });

    it("rejects when the LLM returns malformed JSON", async () => {
      stubLlm("this is not json at all");

      await expect(
        executeImport(TRANSCRIPT, "Model", "anthropic"),
      ).rejects.toThrow("Failed to parse");
    });

    it("rejects on an empty transcript", async () => {
      stubLlm(emptyExtraction());

      await expect(
        executeImport("", "Model", "anthropic"),
      ).rejects.toThrow("empty");
    });
  });

  describe("extraction feature flow-through", () => {
    it("includes extracted object types and fact types in the output", async () => {
      stubLlm(comprehensiveExtraction());

      const result = await executeImport(TRANSCRIPT, "Workforce");
      const yaml = result.content[0]!.text;

      expect(yaml).toContain("Person");
      expect(yaml).toContain("Project");
      expect(yaml).toContain("Person works on Project");
      expect(yaml).toContain("Person manages Person");
    });

    it("includes all eleven inferred constraint types in the output", async () => {
      stubLlm(comprehensiveExtraction());

      const result = await executeImport(TRANSCRIPT, "Workforce");
      const yaml = result.content[0]!.text;

      const constraintTypes = [
        "internal_uniqueness",
        "mandatory",
        "external_uniqueness",
        "value_constraint",
        "disjunctive_mandatory",
        "exclusion",
        "exclusive_or",
        "subset",
        "equality",
        "ring",
        "frequency",
      ];
      for (const type of constraintTypes) {
        expect(yaml).toMatch(new RegExp(`type: "?${type}"?`));
      }
    });

    it("includes objectified fact types in the output", async () => {
      stubLlm(comprehensiveExtraction());

      const result = await executeImport(TRANSCRIPT, "Workforce");
      const yaml = result.content[0]!.text;

      expect(yaml).toContain("objectified_fact_types:");
      expect(yaml).toContain("Assignment");
    });

    it("includes object type aliases in the output", async () => {
      stubLlm(comprehensiveExtraction());

      const result = await executeImport(TRANSCRIPT, "Workforce");
      const yaml = result.content[0]!.text;

      expect(yaml).toContain("aliases:");
      expect(yaml).toContain("Individual");
      expect(yaml).toContain("Party");
    });
  });

  describe("model naming", () => {
    it("uses the provided model name", async () => {
      stubLlm(emptyExtraction());

      const result = await executeImport(TRANSCRIPT, "Custom Domain");
      expect(result.content[0]!.text).toContain("name: Custom Domain");
    });

    it("uses the default model name when omitted", async () => {
      stubLlm(emptyExtraction());

      const result = await executeImport(TRANSCRIPT);
      expect(result.content[0]!.text).toContain("name: Extracted Model");
    });
  });

  describe("base model context", () => {
    it("feeds the base model into the extraction prompt", async () => {
      const complete = stubLlm(emptyExtraction());

      await executeImport(
        TRANSCRIPT,
        "Model",
        undefined,
        undefined,
        `${fixtures}/simple.orm.yaml`,
      );

      expect(complete).toHaveBeenCalledTimes(1);
      const request = complete.mock.calls[0]![0] as CompletionRequest;
      expect(request.userMessage).toContain("existing_model");
      expect(request.userMessage).toContain("Customer");
    });

    it("proceeds without context when the base model cannot be resolved", async () => {
      const complete = stubLlm(emptyExtraction());

      const result = await executeImport(
        TRANSCRIPT,
        "Model",
        undefined,
        undefined,
        "/nonexistent/base.orm.yaml",
      );

      const request = complete.mock.calls[0]![0] as CompletionRequest;
      expect(request.userMessage).not.toContain("existing_model");
      expect(result.content[0]!.text).toContain("name: Model");
    });
  });

  describe("transcript source resolution", () => {
    it("reads the transcript from a file path", async () => {
      const complete = stubLlm(emptyExtraction());
      const dir = mkdtempSync(join(tmpdir(), "mcp-import-test-"));
      try {
        const file = join(dir, "session.md");
        writeFileSync(file, "A unique transcript sentence about widgets.");

        await executeImport(file, "Model");

        const request = complete.mock.calls[0]![0] as CompletionRequest;
        expect(request.userMessage).toContain("widgets");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("MCP response format", () => {
    it("returns a single text content entry", async () => {
      stubLlm(comprehensiveExtraction());

      const result = await executeImport(TRANSCRIPT, "Model");

      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe("text");
      expect(typeof result.content[0]!.text).toBe("string");
    });
  });
});
