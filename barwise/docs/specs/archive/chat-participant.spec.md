# barwise: @barwise Chat Participant for Copilot Chat

Status: Implemented -- @barwise chat participant registered via
vscode.chat.createChatParticipant (packages/vscode/src/chat/) with
14 slash commands in the manifest.
Created: 2026-03-08
Last-updated: 2026-07-25

## Problem

Users expect to type `@barwise import this transcript` in Copilot Chat,
but the extension only registers Language Model Tools
(`vscode.lm.registerTool`) and an MCP stdio server. There is no chat
participant, so `@barwise` does not appear in the chat participant
dropdown. Users must either use the command palette or hope Copilot
autonomously selects the right tool -- there is no way to explicitly
direct a request to barwise.

## Solution

Add a `@barwise` chat participant using
`vscode.chat.createChatParticipant()`. The participant acts as an ORM 2
domain expert. It uses the `@vscode/chat-extension-utils` library to
delegate to the Copilot language model with access to the already-
registered `barwise_*` Language Model Tools. The participant provides
domain context through a system prompt and lets Copilot orchestrate
the existing tools.

## Design decisions

### Thin participant, tools do the work

The participant handler provides a system prompt and filters available
tools by tag. All ORM operations (validation, verbalization, import,
schema, diagram, diff, merge) are handled by the 7 existing Language
Model Tools. No business logic is duplicated in the participant handler.

### Use @vscode/chat-extension-utils

The `sendChatParticipantRequest` function from this library handles the
tool-calling loop automatically: send request to the language model,
detect tool call responses, invoke tools via `vscode.lm.invokeTool`,
feed results back, and stream the final response. This avoids
reimplementing multi-turn tool orchestration.

### Slash commands for common workflows

Register participant commands for the most common operations. These
prepend focused instructions to the user's prompt so Copilot selects
the right tool without ambiguity. Free-form prompts (no command) also
work -- Copilot picks tools based on the system prompt and user intent.

| Command      | Maps to tool                | Purpose                            |
| ------------ | --------------------------- | ---------------------------------- |
| `/import`    | `barwise_import_transcript` | Extract ORM model from transcript  |
| `/validate`  | `barwise_validate_model`    | Validate an ORM model              |
| `/verbalize` | `barwise_verbalize_model`   | Generate natural-language readings |
| `/diagram`   | `barwise_generate_diagram`  | Generate SVG diagram               |
| `/schema`    | `barwise_generate_schema`   | Generate relational schema (DDL)   |

### Follow-up provider

After each response, suggest contextual next actions based on which
tool was used. For example, after an import, suggest validating or
generating a diagram.

### One participant per extension

VS Code guidelines recommend at most one chat participant per
extension. The `@barwise` participant covers all ORM operations through
its tool access.

## Types

```typescript
// No new public types. The participant is internal to the vscode package.
```

## Implementation

### System prompt

The system prompt establishes the participant's identity and
capabilities:

```
You are Barwise, an ORM 2 (Object-Role Modeling) domain expert. You
help users create, validate, and explore conceptual data models.

You have access to tools for:
- Importing transcripts into ORM models
- Validating ORM models against structural rules
- Verbalizing models as natural-language readings
- Generating relational schemas (DDL)
- Generating SVG diagrams
- Diffing and merging models

When the user provides a transcript or domain description, use the
import tool. When they provide or reference an .orm.yaml file, read it
and use the appropriate tool. Always explain your results clearly.

ORM models use .orm.yaml files. Key concepts: entity types (identified
by reference modes), value types, fact types (with roles and readings),
and constraints (uniqueness, mandatory, frequency, ring, subset,
equality, exclusion, value, subtype).
```

### Handler flow

```typescript
import * as chatUtils from "@vscode/chat-extension-utils";

const handler: vscode.ChatRequestHandler = async (
  request,
  context,
  stream,
  token,
) => {
  let prompt = SYSTEM_PROMPT;

  // Prepend command-specific instructions
  if (request.command) {
    prompt += "\n\n" + getCommandInstruction(request.command);
  }

  const tools = vscode.lm.tools.filter(t => t.tags.includes("orm"));

  const result = chatUtils.sendChatParticipantRequest(request, context, {
    prompt,
    tools,
    responseStreamOptions: {
      stream,
      references: true,
      responseText: true,
    },
  }, token);

  return await result.result;
};
```

### Command instructions

Each slash command prepends focused instructions:

- `/import` -- "The user wants to import a transcript into an ORM
  model. Use the barwise_import_transcript tool with the transcript
  they provide."
- `/validate` -- "The user wants to validate an ORM model. Use the
  barwise_validate_model tool."
- `/verbalize` -- "The user wants to verbalize an ORM model. Use the
  barwise_verbalize_model tool."
- `/diagram` -- "The user wants to generate an ORM diagram. Use the
  barwise_generate_diagram tool."
- `/schema` -- "The user wants to generate a relational schema. Use the
  barwise_generate_schema tool."

### Follow-up provider

```typescript
const followupProvider: vscode.ChatFollowupProvider = {
  provideFollowups(result, context, token) {
    // Suggest contextual next actions based on the last tool used
    return [
      { prompt: "Validate the model", command: "validate" },
      { prompt: "Generate a diagram", command: "diagram" },
    ];
  },
};
```

## Integration

In `extension.ts`, during activation:

```typescript
import { registerChatParticipant } from "../chat/ChatParticipant.js";

// After existing registrations:
registerChatParticipant(context);
```

## Files

### New files

- `packages/vscode/src/chat/ChatParticipant.ts` -- participant handler,
  system prompt, command routing, follow-up provider

### Modified files

- `packages/vscode/src/client/extension.ts` -- call
  `registerChatParticipant(context)`
- `packages/vscode/package.json` -- add `contributes.chatParticipants`
  declaration, add `@vscode/chat-extension-utils` dependency

## package.json changes

### chatParticipants

```json
"chatParticipants": [
  {
    "id": "barwise.chatParticipant",
    "name": "barwise",
    "fullName": "Barwise ORM Modeler",
    "description": "ORM 2 data modeling expert -- import transcripts, validate models, generate schemas and diagrams",
    "isSticky": true,
    "commands": [
      {
        "name": "import",
        "description": "Import a transcript into an ORM model"
      },
      {
        "name": "validate",
        "description": "Validate an ORM model"
      },
      {
        "name": "verbalize",
        "description": "Generate natural-language readings"
      },
      {
        "name": "diagram",
        "description": "Generate an ORM diagram"
      },
      {
        "name": "schema",
        "description": "Generate a relational schema"
      }
    ]
  }
]
```

### New dependency

```json
"@vscode/chat-extension-utils": "^0.2.0"
```

## Test coverage

- Unit test: participant handler delegates to
  `sendChatParticipantRequest` with correct system prompt
- Unit test: each slash command prepends the right instruction
- Unit test: tools are filtered by "orm" tag
- Unit test: follow-up provider returns relevant suggestions
- Manual test: `@barwise import this transcript` in Copilot Chat
  produces an .orm.yaml
- Manual test: `@barwise /validate` validates the active model

## Success criteria

- `@barwise` appears in the Copilot Chat participant list
- `@barwise import <transcript>` produces an ORM model
- `/import`, `/validate`, `/verbalize`, `/diagram`, `/schema` commands
  work and route to the correct tools
- Free-form prompts like `@barwise what entity types are in this model?`
  are handled through tool orchestration
- Follow-up suggestions appear after tool responses
- All existing tests continue to pass
