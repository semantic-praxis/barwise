import { type OrmModel, OrmYamlSerializer } from "@barwise/core";
import { generateCounterexamples } from "@barwise/core/counterexample";
import { Verbalizer } from "@barwise/core/verbalization";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { Hover, type Position } from "vscode-languageserver/node.js";

/**
 * Provides hover information for .orm.yaml files.
 *
 * Hovering over an object type name shows its definition and the
 * fact types it participates in (verbalized).
 */
export class HoverProvider {
  private readonly serializer = new OrmYamlSerializer();
  private readonly verbalizer = new Verbalizer();

  /**
   * @param showCounterexamples When true, the hover includes a "Rules out"
   *   section listing what each constraint forbids. Opt-in (default off)
   *   via the `barwise.showCounterexamplesOnHover` setting.
   */
  constructor(private readonly showCounterexamples: boolean = false) {}

  provideHover(
    document: TextDocument,
    position: Position,
  ): Hover | null {
    const text = document.getText();
    const line = getLine(text, position.line);
    const word = getWordAtPosition(line, position.character);
    if (!word) return null;

    let model: OrmModel;
    try {
      model = this.serializer.deserialize(text);
    } catch {
      return null;
    }

    // Check if the word matches an object type name.
    const ot = model.getObjectTypeByName(word);
    if (ot) {
      return this.objectTypeHover(ot, model);
    }

    // Check if the word matches an object type id (for player references).
    const otById = model.getObjectType(word);
    if (otById) {
      return this.objectTypeHover(otById, model);
    }

    return null;
  }

  private objectTypeHover(
    ot: { id: string; name: string; kind: string; definition?: string; },
    model: OrmModel,
  ): Hover {
    const lines: string[] = [];
    lines.push(`**${ot.name}** (${ot.kind})`);

    if (ot.definition) {
      lines.push("", ot.definition);
    }

    // Show fact types this object type participates in.
    const factTypes = model.factTypesForObjectType(ot.id);
    if (factTypes.length > 0) {
      lines.push("", "**Fact types:**");
      for (const ft of factTypes) {
        const verbalizations = this.verbalizer.factTypes.verbalizeAll(
          ft,
          model,
        );
        for (const v of verbalizations) {
          lines.push(`- ${v.text}`);
        }
      }
    }

    // Counterexamples: what the object type's constraints rule out.
    if (this.showCounterexamples && factTypes.length > 0) {
      const ftIds = new Set(factTypes.map((ft) => ft.id));
      const ces = generateCounterexamples(model).filter((c) => ftIds.has(c.factTypeId));
      if (ces.length > 0) {
        lines.push("", "**Rules out:**");
        for (const c of ces) {
          lines.push(`- ${c.text}`);
        }
      }
    }

    return {
      contents: {
        kind: "markdown",
        value: lines.join("\n"),
      },
    };
  }
}

function getLine(text: string, line: number): string {
  const lines = text.split("\n");
  return lines[line] ?? "";
}

function getWordAtPosition(
  line: string,
  character: number,
): string | undefined {
  // Find word boundaries around the cursor position.
  const wordPattern = /[\w-]+/g;
  let match: RegExpExecArray | null;
  while ((match = wordPattern.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0]!.length;
    if (character >= start && character <= end) {
      return match[0];
    }
  }
  return undefined;
}
