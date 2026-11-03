import { storeIds } from "@barwise/core";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { type CodeAction, CodeActionKind, type Diagnostic } from "vscode-languageserver/node";
import { diagnosticSource } from "./DiagnosticsProvider.js";

/** The diagnostic source the "Store ids" action answers. */
export const UNSTORED_ID_SOURCE = diagnosticSource("structural/unstored-id");

/**
 * The editor action that stores the ids a 4.0 file leaves to the load
 * (iri-identity decision 17): each is written into the file's own text,
 * comments and layout kept, as `barwise migrate` writes it. Offered when
 * the request carries an unstored-id diagnostic, and it fixes all of them
 * at once, since storing one id and not the next leaves the file in the
 * same state.
 */
export function storeIdsAction(
  document: TextDocument,
  diagnostics: readonly Diagnostic[],
): CodeAction[] {
  const answered = diagnostics.filter((d) => d.source === UNSTORED_ID_SOURCE);
  if (answered.length === 0) return [];
  let result;
  try {
    result = storeIds(document.getText());
  } catch {
    // The file does not load; the parse error is already shown.
    return [];
  }
  if (result.stored.length === 0) return [];
  return [{
    // One title whatever the count, so the diagnostic can name it.
    title: "Store ids",
    kind: CodeActionKind.QuickFix,
    diagnostics: answered,
    isPreferred: true,
    edit: {
      changes: {
        [document.uri]: [{
          range: {
            start: { line: 0, character: 0 },
            end: document.positionAt(Number.MAX_SAFE_INTEGER),
          },
          newText: result.text,
        }],
      },
    },
  }];
}
