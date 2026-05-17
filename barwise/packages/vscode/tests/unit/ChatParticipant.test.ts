/**
 * Unit tests for the chat participant prompts and configuration.
 *
 * The handler itself requires the VS Code runtime (vscode.chat,
 * vscode.lm, etc.), so it is covered by integration tests. These
 * unit tests verify the exported constants and configuration that
 * drive the participant's behavior. The constants live in
 * chatPrompts.ts (no VS Code dependency) so they can be tested here.
 */
import { describe, expect, it } from "vitest";
import {
  COMMAND_INSTRUCTIONS,
  FOLLOWUP_SUGGESTIONS,
  SYSTEM_PROMPT,
} from "../../src/chat/chatPrompts.js";

describe("ChatParticipant", () => {
  describe("SYSTEM_PROMPT", () => {
    it("identifies as an ORM 2 domain expert", () => {
      expect(SYSTEM_PROMPT).toContain("ORM 2");
      expect(SYSTEM_PROMPT).toContain("Barwise");
    });

    it("lists all available tool names", () => {
      const expectedTools = [
        "barwise_import_transcript",
        "barwise_import_model",
        "barwise_validate_model",
        "barwise_verbalize_model",
        "barwise_generate_schema",
        "barwise_generate_diagram",
        "barwise_export_model",
        "barwise_diff_models",
        "barwise_merge_models",
        "barwise_describe_domain",
        "barwise_review_model",
        "barwise_lineage_status",
        "barwise_impact_analysis",
      ];
      for (const tool of expectedTools) {
        expect(SYSTEM_PROMPT).toContain(tool);
      }
    });

    it("mentions key ORM concepts", () => {
      const concepts = [
        "entity types",
        "value types",
        "fact types",
        "constraints",
        ".orm.yaml",
      ];
      for (const concept of concepts) {
        expect(SYSTEM_PROMPT).toContain(concept);
      }
    });
  });

  describe("COMMAND_INSTRUCTIONS", () => {
    it("has instructions for all 13 slash commands", () => {
      const expectedCommands = [
        "import",
        "validate",
        "verbalize",
        "diagram",
        "schema",
        "diff",
        "merge",
        "export",
        "describe",
        "import-model",
        "review",
        "lineage",
        "impact",
      ];
      for (const cmd of expectedCommands) {
        expect(COMMAND_INSTRUCTIONS).toHaveProperty(cmd);
        expect(COMMAND_INSTRUCTIONS[cmd]!.length).toBeGreaterThan(0);
      }
    });

    it("import instruction references the import tool", () => {
      expect(COMMAND_INSTRUCTIONS.import).toContain(
        "barwise_import_transcript",
      );
    });

    it("validate instruction references the validate tool", () => {
      expect(COMMAND_INSTRUCTIONS.validate).toContain(
        "barwise_validate_model",
      );
    });

    it("verbalize instruction references the verbalize tool", () => {
      expect(COMMAND_INSTRUCTIONS.verbalize).toContain(
        "barwise_verbalize_model",
      );
    });

    it("diagram instruction references the diagram tool", () => {
      expect(COMMAND_INSTRUCTIONS.diagram).toContain(
        "barwise_generate_diagram",
      );
    });

    it("schema instruction references the schema tool", () => {
      expect(COMMAND_INSTRUCTIONS.schema).toContain(
        "barwise_generate_schema",
      );
    });

    it("diff instruction references the diff tool", () => {
      expect(COMMAND_INSTRUCTIONS.diff).toContain(
        "barwise_diff_models",
      );
    });

    it("merge instruction references the merge tool", () => {
      expect(COMMAND_INSTRUCTIONS.merge).toContain(
        "barwise_merge_models",
      );
    });

    it("export instruction references the export tool", () => {
      expect(COMMAND_INSTRUCTIONS.export).toContain(
        "barwise_export_model",
      );
    });

    it("describe instruction references the describe tool", () => {
      expect(COMMAND_INSTRUCTIONS.describe).toContain(
        "barwise_describe_domain",
      );
    });

    it("import-model instruction references the import-model tool", () => {
      expect(COMMAND_INSTRUCTIONS["import-model"]).toContain(
        "barwise_import_model",
      );
    });

    it("review instruction references the review tool", () => {
      expect(COMMAND_INSTRUCTIONS.review).toContain(
        "barwise_review_model",
      );
    });

    it("lineage instruction references the lineage tool", () => {
      expect(COMMAND_INSTRUCTIONS.lineage).toContain(
        "barwise_lineage_status",
      );
    });

    it("impact instruction references the impact tool", () => {
      expect(COMMAND_INSTRUCTIONS.impact).toContain(
        "barwise_impact_analysis",
      );
    });
  });

  describe("symbolic query integration", () => {
    it("system prompt lists the query tool", () => {
      expect(SYSTEM_PROMPT).toContain("barwise_query_model");
    });

    it("system prompt directs the agent to prefer deterministic queries", () => {
      expect(SYSTEM_PROMPT).toContain("deterministic");
      expect(SYSTEM_PROMPT.toLowerCase()).toContain("rather than guessing");
    });

    it("system prompt covers at least 5 deterministic query types", () => {
      const queryCommands = [
        "entities",
        "fact-types-of",
        "constraints-of",
        "mandatory-roles",
        "path",
        "subtypes-of",
        "stats",
      ];
      const covered = queryCommands.filter((cmd) => SYSTEM_PROMPT.includes(cmd));
      expect(covered.length).toBeGreaterThanOrEqual(5);
    });

    it("query command instruction references the query tool", () => {
      expect(COMMAND_INSTRUCTIONS).toHaveProperty("query");
      expect(COMMAND_INSTRUCTIONS.query).toContain("barwise_query_model");
    });
  });

  describe("FOLLOWUP_SUGGESTIONS", () => {
    it("suggests validate, diagram, verbalize, schema, export, and review", () => {
      const commands = FOLLOWUP_SUGGESTIONS.map((s) => s.command);
      expect(commands).toContain("validate");
      expect(commands).toContain("diagram");
      expect(commands).toContain("verbalize");
      expect(commands).toContain("schema");
      expect(commands).toContain("export");
      expect(commands).toContain("review");
    });

    it("each suggestion has a non-empty prompt", () => {
      for (const suggestion of FOLLOWUP_SUGGESTIONS) {
        expect(suggestion.prompt.length).toBeGreaterThan(0);
      }
    });
  });
});
