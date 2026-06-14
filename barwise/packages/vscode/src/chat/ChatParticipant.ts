/**
 * @barwise chat participant for Copilot Chat.
 *
 * Registers a `@barwise` chat participant so users can type
 * `@barwise import this transcript` directly in Copilot Chat. The
 * participant provides an ORM 2 domain-expert system prompt and
 * delegates all actual work to the existing Language Model Tools
 * (barwise_validate_model, barwise_import_transcript, etc.).
 *
 * Uses @vscode/chat-extension-utils to handle the tool-calling loop
 * automatically.
 */

import { sendChatParticipantRequest } from "@vscode/chat-extension-utils";
import * as vscode from "vscode";
import { getOpenModelPath, referencedOrmFiles } from "../mcp/openModel.js";
import {
  COMMAND_INSTRUCTIONS,
  FOLLOWUP_SUGGESTIONS,
  PARTICIPANT_ID,
  SYSTEM_PROMPT,
  TOOL_TAG,
} from "./chatPrompts.js";

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const handler: vscode.ChatRequestHandler = async (
  request,
  context,
  stream,
  token,
) => {
  let prompt = SYSTEM_PROMPT;

  if (request.command && request.command in COMMAND_INSTRUCTIONS) {
    prompt += "\n\n" + COMMAND_INSTRUCTIONS[request.command];
  }

  // Resolve the model from the attached references, the open editor, or
  // the open diagram, and tell the model to pass it as the tool source.
  // Without this the tools only see the focused editor, which is
  // undefined when the diagram webview or the chat panel is focused.
  const modelPath = getOpenModelPath(referencedOrmFiles(request));
  if (modelPath) {
    prompt += `\n\nThe user's active ORM model is at \`${modelPath}\`. `
      + "Pass this exact path as the `source` argument to barwise tools "
      + "unless the user names a different file.";
  }

  const tools = vscode.lm.tools.filter((t) => t.tags.includes(TOOL_TAG));

  const chatResult = sendChatParticipantRequest(
    request,
    context,
    {
      prompt,
      tools,
      responseStreamOptions: {
        stream,
        references: true,
        responseText: true,
      },
    },
    token,
  );

  return await chatResult.result;
};

// ---------------------------------------------------------------------------
// Follow-up provider
// ---------------------------------------------------------------------------

const followupProvider: vscode.ChatFollowupProvider = {
  provideFollowups(
    _result: vscode.ChatResult,
    _context: vscode.ChatContext,
    _token: vscode.CancellationToken,
  ): vscode.ProviderResult<vscode.ChatFollowup[]> {
    return [...FOLLOWUP_SUGGESTIONS];
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the @barwise chat participant.
 *
 * Call this from the extension's `activate` function after registering
 * Language Model Tools (the participant depends on them being available).
 */
export function registerChatParticipant(
  context: vscode.ExtensionContext,
): void {
  const participant = vscode.chat.createChatParticipant(
    PARTICIPANT_ID,
    handler,
  );

  participant.iconPath = vscode.Uri.joinPath(
    context.extensionUri,
    "media",
    "icon.png",
  );

  participant.followupProvider = followupProvider;

  context.subscriptions.push(participant);
}
