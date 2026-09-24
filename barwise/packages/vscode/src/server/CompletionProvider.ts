import { OrmYamlSerializer } from "@barwise/core";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { CompletionItem, CompletionItemKind, type Position } from "vscode-languageserver/node";
import { parse } from "yaml";

/**
 * Provides completion items for .orm.yaml files.
 *
 * Current completions:
 * - Object type names when editing a `player` field in a role.
 * - Constraint types when editing a `type` field in a constraint.
 * - Object type kinds when editing a `kind` field.
 */
export class CompletionProvider {
  private readonly serializer = new OrmYamlSerializer();

  provideCompletions(
    document: TextDocument,
    position: Position,
  ): CompletionItem[] {
    const text = document.getText();
    const line = getLine(text, position.line);
    const trimmed = line.trim();

    // Offer object type names for player references.
    if (trimmed.startsWith("player:") || trimmed.startsWith("player: ")) {
      return this.objectTypeCompletions(text);
    }

    // Offer constraint types.
    if (trimmed.startsWith("type:") || trimmed.startsWith("- type:")) {
      return this.constraintTypeCompletions();
    }

    // Offer object type kinds.
    if (trimmed.startsWith("kind:")) {
      return [
        {
          label: "entity",
          kind: CompletionItemKind.EnumMember,
          detail: "Entity type (identified by reference mode)",
        },
        {
          label: "value",
          kind: CompletionItemKind.EnumMember,
          detail: "Value type (self-identifying)",
        },
      ];
    }

    return [];
  }

  private objectTypeCompletions(text: string): CompletionItem[] {
    try {
      const doc = parse(text) as Record<string, unknown>;
      const model = (doc as { model?: { object_types?: Array<{ id: string; name: string; }>; }; })
        .model;
      if (!model?.object_types) return [];

      return model.object_types.map((ot) => ({
        label: ot.id,
        kind: CompletionItemKind.Reference,
        detail: ot.name,
        documentation: `Reference to object type "${ot.name}"`,
      }));
    } catch {
      return [];
    }
  }

  private constraintTypeCompletions(): CompletionItem[] {
    return [
      {
        label: "internal_uniqueness",
        kind: CompletionItemKind.EnumMember,
        detail: "Internal uniqueness constraint",
        documentation: "Each combination of values in the specified roles is unique.",
      },
      {
        label: "mandatory",
        kind: CompletionItemKind.EnumMember,
        detail: "Mandatory role constraint",
        documentation: "Every instance of the object type must participate.",
      },
      {
        label: "external_uniqueness",
        kind: CompletionItemKind.EnumMember,
        detail: "External uniqueness constraint",
        documentation: "Uniqueness across roles from different fact types.",
      },
      {
        label: "value_constraint",
        kind: CompletionItemKind.EnumMember,
        detail: "Value constraint",
        documentation: "Restricts the allowed values.",
      },
    ];
  }
}

function getLine(text: string, line: number): string {
  const lines = text.split("\n");
  return lines[line] ?? "";
}
