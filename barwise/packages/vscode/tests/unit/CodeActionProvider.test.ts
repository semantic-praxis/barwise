/**
 * The editor's side of decision 17 (iri-identity WS6, 6b-3a): an id a 4.0
 * file leaves to the load is shown where its element sits, and the
 * "Store ids" action writes it into the file.
 */
import { describe, expect, it, vi } from "vitest";
import { TextDocument } from "vscode-languageserver-textdocument";
import { storeIdsAction, UNSTORED_ID_SOURCE } from "../../src/server/CodeActionProvider.js";
import { DiagnosticsProvider } from "../../src/server/DiagnosticsProvider.js";

const TYPED = `orm_version: "4.0"
model:
  name: M
  object_types:
    - { id: Person, name: Person, kind: entity, reference_mode: nr }
  fact_types:
    - id: Person_smokes
      name: Person smokes
      roles:
        - { id: Person_smokes.smokes, player: Person, role_name: smokes }
      readings: ["{0} smokes"]
      constraints:
        # typed without an id
        - { type: mandatory, role: Person_smokes.smokes }
`;

const doc = (text: string) => TextDocument.create("file:///m.orm.yaml", "orm-yaml", 1, text);

function diagnosticsOf(text: string) {
  const connection = { sendDiagnostics: vi.fn() };
  new DiagnosticsProvider(connection as never).validate(doc(text));
  return connection.sendDiagnostics.mock.calls[0]![0]!.diagnostics as {
    source: string;
    message: string;
    range: { start: { line: number; character: number; }; };
  }[];
}

describe("an id the file does not state, in the editor", () => {
  it("is warned of on the line of the element that has no id", () => {
    const [warning] = diagnosticsOf(TYPED).filter((d) => d.source === UNSTORED_ID_SOURCE);
    expect(warning!.message).toContain('"Each_Person_smokes" is not stored');
    // Line 13, zero-based: the constraint's `- {`, not the top of the file.
    expect(warning!.range.start).toEqual({ line: 13, character: 10 });
  });

  it("is stored by the action, which replaces the text with the file plus its ids", () => {
    const diagnostics = diagnosticsOf(TYPED).filter((d) => d.source === UNSTORED_ID_SOURCE);
    const [action] = storeIdsAction(doc(TYPED), diagnostics as never);
    expect(action!.title).toBe("Store ids");
    const [edit] = action!.edit!.changes!["file:///m.orm.yaml"]!;
    expect(edit!.range.start).toEqual({ line: 0, character: 0 });
    expect(edit!.range.end).toEqual(doc(TYPED).positionAt(TYPED.length));
    expect(edit!.newText).toContain("# typed without an id");
    expect(edit!.newText).toContain("id: Each_Person_smokes");
    expect(diagnosticsOf(edit!.newText).map((d) => d.source)).not.toContain(UNSTORED_ID_SOURCE);
  });

  it("is not offered without the diagnostic it answers", () => {
    expect(storeIdsAction(doc(TYPED), [])).toEqual([]);
  });
});

describe("a file before 4.0, in the editor", () => {
  it("gets the one note naming migrate, at the top of the file", () => {
    const v3 = `orm_version: "3.0"
model:
  name: M
  object_types:
    - { id: u1, name: Person, kind: entity, reference_mode: nr }
`;
    const notes = diagnosticsOf(v3).filter((d) => d.source === "barwise (structural/replayed-ids)");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.message).toContain("barwise migrate");
    expect(notes[0]!.range.start).toEqual({ line: 0, character: 0 });
  });
});
