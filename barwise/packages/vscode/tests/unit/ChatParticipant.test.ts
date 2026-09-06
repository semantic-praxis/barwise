/**
 * Unit tests for the chat participant: its prompts/configuration
 * (no VS Code dependency, tested directly against chatPrompts.ts) and
 * the handler/registration wiring in ChatParticipant.ts itself. The
 * latter imports the real `vscode` API and `@vscode/chat-extension-utils`,
 * neither resolvable outside the editor, so both are mocked here as the
 * boundary -- the same way DiagnosticsProvider's tests mock the LSP
 * Connection rather than the editor. What we exercise is our own logic:
 * prompt assembly, model-path resolution, and tool-tag filtering.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMMAND_INSTRUCTIONS,
  FOLLOWUP_SUGGESTIONS,
  PARTICIPANT_ID,
  SYSTEM_PROMPT,
} from "../../src/chat/chatPrompts.js";

class MockUri {
  constructor(public readonly fsPath: string) {}
  static joinPath(base: MockUri, ...parts: string[]): MockUri {
    return new MockUri([base.fsPath, ...parts].join("/"));
  }
}

vi.mock("vscode", () => ({
  Uri: MockUri,
  window: { activeTextEditor: undefined, visibleTextEditors: [] },
  workspace: { textDocuments: [] },
  chat: {
    createChatParticipant: vi.fn((id: string, handler: unknown) => ({
      id,
      handler,
      iconPath: undefined,
      followupProvider: undefined,
    })),
  },
  lm: { tools: [] },
}));

vi.mock("@vscode/chat-extension-utils", () => ({
  sendChatParticipantRequest: vi.fn(() => ({ result: Promise.resolve({ metadata: {} }) })),
}));

const vscode = (await import("vscode")) as unknown as {
  Uri: typeof MockUri;
  window: { activeTextEditor: unknown; visibleTextEditors: unknown[]; };
  lm: { tools: Array<{ tags: string[]; }>; };
};
const { sendChatParticipantRequest } = await import("@vscode/chat-extension-utils");
const { registerChatParticipant } = await import("../../src/chat/ChatParticipant.js");

function makeContext() {
  return {
    extensionUri: new vscode.Uri("/ext"),
    subscriptions: [] as unknown[],
  };
}

function makeRequest(command?: string, references: unknown[] = []) {
  return { command, references } as never;
}

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

    it("includes the shared context-hygiene guidance", () => {
      expect(SYSTEM_PROMPT).toContain("Context-efficient use of the barwise tools");
      expect(SYSTEM_PROMPT).toContain("write large artifacts to a file");
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

describe("registerChatParticipant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscode.window.activeTextEditor = undefined;
    vscode.window.visibleTextEditors = [];
    vscode.lm.tools = [
      { tags: ["orm"] },
      { tags: ["other"] },
    ];
  });

  it("registers the @barwise participant with its icon and followup provider", () => {
    const context = makeContext();
    registerChatParticipant(context as never);

    expect(context.subscriptions).toHaveLength(1);
    const participant = context.subscriptions[0] as {
      id: string;
      iconPath: MockUri;
      followupProvider: { provideFollowups: (...args: never[]) => unknown; };
    };
    expect(participant.id).toBe(PARTICIPANT_ID);
    expect(participant.iconPath.fsPath).toBe("/ext/media/icon.png");
    expect(participant.followupProvider).toBeDefined();
  });

  it("follow-up provider returns the configured suggestions", async () => {
    const context = makeContext();
    registerChatParticipant(context as never);
    const participant = context.subscriptions[0] as {
      followupProvider: {
        provideFollowups: (...args: never[]) => Promise<unknown> | unknown;
      };
    };

    const followups = await participant.followupProvider.provideFollowups(
      undefined as never,
      undefined as never,
      undefined as never,
    );
    expect(followups).toEqual(FOLLOWUP_SUGGESTIONS);
  });

  describe("the request handler", () => {
    function registerAndGetHandler() {
      const context = makeContext();
      registerChatParticipant(context as never);
      const participant = context.subscriptions[0] as {
        handler: (
          request: unknown,
          context: unknown,
          stream: unknown,
          token: unknown,
        ) => Promise<unknown>;
      };
      return participant.handler;
    }

    it("uses the base system prompt and only orm-tagged tools when there is no command or open model", async () => {
      const handler = registerAndGetHandler();
      const request = makeRequest(undefined);

      const result = await handler(request, {}, {}, {});

      expect(sendChatParticipantRequest).toHaveBeenCalledTimes(1);
      const [sentRequest, , options] = vi.mocked(sendChatParticipantRequest).mock.calls[0]!;
      expect(sentRequest).toBe(request);
      expect(options.prompt).toBe(SYSTEM_PROMPT);
      // Only the tool tagged "orm" is offered to the model.
      expect(options.tools).toEqual([{ tags: ["orm"] }]);
      expect(result).toEqual({ metadata: {} });
    });

    it("appends the command instructions for a recognized slash command", async () => {
      const handler = registerAndGetHandler();
      const request = makeRequest("validate");

      await handler(request, {}, {}, {});

      const [, , options] = vi.mocked(sendChatParticipantRequest).mock.calls[0]!;
      expect(options.prompt).toContain(SYSTEM_PROMPT);
      expect(options.prompt).toContain(COMMAND_INSTRUCTIONS.validate);
    });

    it("does not append instructions for an unrecognized command", async () => {
      const handler = registerAndGetHandler();
      const request = makeRequest("not-a-real-command");

      await handler(request, {}, {}, {});

      const [, , options] = vi.mocked(sendChatParticipantRequest).mock.calls[0]!;
      expect(options.prompt).toBe(SYSTEM_PROMPT);
    });

    it("tells the model which .orm.yaml file is open in the focused editor", async () => {
      vscode.window.activeTextEditor = {
        document: {
          fileName: "/workspace/clinic.orm.yaml",
          uri: { fsPath: "/workspace/clinic.orm.yaml" },
        },
      };
      const handler = registerAndGetHandler();
      const request = makeRequest(undefined);

      await handler(request, {}, {}, {});

      const [, , options] = vi.mocked(sendChatParticipantRequest).mock.calls[0]!;
      expect(options.prompt).toContain("/workspace/clinic.orm.yaml");
      expect(options.prompt).toContain("Pass this exact path");
    });

    it("passes the response stream and token through to sendChatParticipantRequest", async () => {
      const handler = registerAndGetHandler();
      const stream = { markdown: vi.fn() };
      const token = { isCancellationRequested: false };

      await handler(makeRequest(undefined), {}, stream, token);

      const [, , options, sentToken] = vi.mocked(sendChatParticipantRequest).mock.calls[0]!;
      expect(options.responseStreamOptions?.stream).toBe(stream);
      expect(sentToken).toBe(token);
    });
  });
});
