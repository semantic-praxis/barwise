/**
 * What a file states of its model's ids (iri-identity WS6, 6b-3a): the
 * ids a 4.0 file leaves to the load (decision 17), written into the file
 * by `storeIds` and reported until they are; the one note a file before
 * 4.0 gets (barwise-wcg.frh); and a shadow replayed with its owner's id.
 */
import { describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { replayInto40 } from "../../src/serialization/replay.js";
import { storeIds } from "../../src/serialization/storeIds.js";
import { ValidationEngine } from "../../src/validation/ValidationEngine.js";
import { modelCorpus } from "../helpers/modelCorpus.js";

const serializer = new OrmYamlSerializer();
const read = (yaml: string) => serializer.deserialize(yaml, { lenient: true });
const ruleIds = (yaml: string) => new ValidationEngine().validate(read(yaml)).map((d) => d.ruleId);

/** Person smokes, with a mandatory constraint the person typed without an id. */
const typed = `orm_version: "4.0"
model:
  name: M
  object_types:
    - { id: Person, name: Person, kind: entity, reference_mode: nr }
    - { id: Smoker, name: Smoker, kind: entity, reference_mode: nr }
  fact_types:
    - id: Person_smokes
      name: Person smokes
      roles:
        - { id: Person_smokes.smokes, player: Person, role_name: smokes }
      readings: ["{0} smokes"]
      constraints:
        # Typed in the editor; no id yet.
        - type: mandatory
          role: Person_smokes.smokes
  subtype_facts:
    - subtype: Smoker
      supertype: Person
`;

describe("ids a 4.0 file does not state", () => {
  it("are listed on the model the file loads to, and not those the file states", () => {
    const model = read(typed);
    expect(model.unstoredIds).toEqual(["Each_Person_smokes", "Smoker_is_a_subtype_of_Person"]);
    const stated = storeIds(typed).text;
    expect(read(stated).unstoredIds).toEqual([]);
  });

  it("each get a warning naming the id, until the file states it", () => {
    const diagnostics = new ValidationEngine().validate(read(typed))
      .filter((d) => d.ruleId === "structural/unstored-id");
    expect(diagnostics.map((d) => [d.severity, d.elementId])).toEqual([
      ["warning", "Each_Person_smokes"],
      ["warning", "Smoker_is_a_subtype_of_Person"],
    ]);
    expect(diagnostics[0]!.message).toContain("barwise migrate");
    expect(ruleIds(storeIds(typed).text)).not.toContain("structural/unstored-id");
  });

  it("go from the list with their element", () => {
    const model = read(typed);
    model.removeSubtypeFact("Smoker_is_a_subtype_of_Person");
    expect(model.unstoredIds).toEqual(["Each_Person_smokes"]);
  });

  it("are written where the 4.0 writer puts them, with the key the model holds", () => {
    const { text, stored } = storeIds(typed);
    expect(stored.map(({ id, path }) => ({ id, path }))).toEqual([
      { id: "Each_Person_smokes", path: ["model", "fact_types", 0, "constraints", 0] },
      { id: "Smoker_is_a_subtype_of_Person", path: ["model", "subtype_facts", 0] },
    ]);
    // A constraint's id follows its content; a subtype fact's leads it.
    expect(text).toMatch(
      /\n {10}role: Person_smokes\.smokes\n {10}id: Each_Person_smokes\n {10}minted_from: .+\n/,
    );
    expect(text).toMatch(
      /\n {4}- id: Smoker_is_a_subtype_of_Person\n {6}minted_from: .+\n {6}subtype: Smoker\n/,
    );
    // So a later save by any surface leaves each element's keys in place.
    const saved = parse(serializer.serialize(read(text))).model;
    const here = parse(text).model;
    expect(Object.keys(here.fact_types[0].constraints[0]))
      .toEqual(Object.keys(saved.fact_types[0].constraints[0]));
    expect(Object.keys(here.subtype_facts[0])).toEqual(Object.keys(saved.subtype_facts[0]));
    // The key stored is the one the model holds, so decision 14's check
    // has something to compare.
    expect(read(text).mintedFromOf("Each_Person_smokes")).toBe(
      read(typed).mintedFromOf("Each_Person_smokes"),
    );
    expect(serializer.serialize(read(text))).toBe(serializer.serialize(read(typed)));
  });

  it("change no other byte of the file: layout, comments and spacing stay", () => {
    // Hand-written: unpadded flow maps, a wide comment gap, a comment on
    // the line the id goes after, and no newline at the end.
    const hand = `orm_version: "4.0"
model:
  name: M
  object_types:
    - {id: Person, name: Person, kind: entity, reference_mode: nr}
    - {id: Smoker, name: Smoker, kind: entity, reference_mode: nr}
  fact_types:
    - id: Person_smokes
      name: Person smokes
      roles:
        - {id: Person_smokes.smokes, player: Person, role_name: smokes}
      readings: ["{0} smokes"]
      constraints:
        - type: mandatory
          role: Person_smokes.smokes      # the only role
  subtype_facts:
    - {subtype: Smoker, supertype: Person}`;
    const { text, stored } = storeIds(hand);
    expect(stored).toHaveLength(2);
    const removed = stored.reduce((t, s) => t.replace(s.insert.text, ""), text);
    expect(removed).toBe(hand);
    expect(text).toContain(
      "          role: Person_smokes.smokes      # the only role\n          id: Each_Person_smokes\n",
    );
    expect(text).toMatch(/- \{id: Smoker_is_a_subtype_of_Person, minted_from: .+, subtype: Smoker/);
    expect(read(text).unstoredIds).toEqual([]);
    expect(serializer.serialize(read(text))).toBe(serializer.serialize(read(hand)));
  });

  // Required by 6b-3a's second pr-review pass: each element barwise
  // writes, with its id and key taken out, stored again. Most anchors here
  // are block lists (a constraint's `roles:`), which no hand-built case
  // above reached. One case per model, not one loop: the loop's cost grew
  // with the corpus and passed 30s under the pre-commit hook's parallel
  // run while taking 5s alone (barwise-ov2, barwise-6yu).
  describe("give back the bytes a save wrote, for every minted id in every tracked model", () => {
    const corpus = modelCorpus();
    const sites = new Map<string, number>();

    it.each(corpus.map((c) => [c.file, c] as const))("%s", (_file, c) => {
      const text = serializer.serialize(
        replayInto40(serializer.deserializeAsWritten(JSON.stringify(c.doc))),
      );
      // Every minted id and its key out at once: one load per file, and
      // the splices then have to agree with each other too.
      const lines = text.split("\n");
      const removed: string[] = [];
      let here = 0;
      for (let i = 0; i < lines.length; i++) {
        const id = /^(\s*)(- )?id: /.exec(lines[i]!);
        if (!id || !/^\s*minted_from: /.test(lines[i + 1] ?? "")) {
          removed.push(lines[i]!);
          continue;
        }
        here++;
        // Where `id` leads its item, the next key takes the `- `.
        if (id[2]) {
          removed.push(`${id[1]}- ${lines[i + 2]!.trimStart()}`);
          i += 2;
        } else {
          i += 1;
        }
      }
      sites.set(c.file, here);
      if (here === 0) return;
      const back = storeIds(removed.join("\n"));
      expect([c.file, back.stored.length, back.text]).toEqual([c.file, here, text]);
    });

    // Runs after the cases above (a file's tests run in order). A filtered
    // run that skipped some of them fails here by name, not by a low count.
    it("reach more than 200 sites across the corpus", () => {
      expect(sites.size).toBe(corpus.length);
      expect([...sites.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(200);
    });
  });

  it("keep a file's CRLF line endings", () => {
    const crlf = typed.replace(/\n/g, "\r\n");
    const { text } = storeIds(crlf);
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
    expect(read(text).unstoredIds).toEqual([]);
  });

  it("quote an id that a flow map would otherwise end at a comma", () => {
    const flow = `orm_version: "4.0"
model:
  name: M
  object_types:
    - { id: Customer, name: Customer, kind: entity, reference_mode: nr }
    - { id: CustomerNr, name: CustomerNr, kind: value }
  fact_types:
    - id: Customer_has_CustomerNr
      name: Customer has CustomerNr
      roles:
        - { id: Customer_has_CustomerNr.has, player: Customer, role_name: has }
        - { id: Customer_has_CustomerNr.is_of, player: CustomerNr, role_name: is of }
      readings: ["{0} has {1}"]
      constraints:
        - { type: internal_uniqueness, roles: [Customer_has_CustomerNr.is_of] }
`;
    const { text, stored } = storeIds(flow);
    expect(stored[0]!.id).toContain(",");
    expect(text).toContain(`id: ${JSON.stringify(stored[0]!.id)}`);
    expect(read(text).unstoredIds).toEqual([]);
    expect(read(text).factTypes[0]!.internalConstraints[0]!.id).toBe(stored[0]!.id);
  });

  it("are stored in a file that states an empty list, which the writer leaves out", () => {
    // Found by the 6b-3a /code-review: the writer omits `constraints: []`,
    // and the list match then refused the whole file.
    const withEmpty = typed.replace(
      "  subtype_facts:",
      `    - id: Person_runs
      name: Person runs
      roles:
        - { id: Person_runs.runs, player: Person, role_name: runs }
      readings: ["{0} runs"]
      constraints: []
  constraints: []
  subtype_facts:`,
    );
    expect(storeIds(withEmpty).stored.map((s) => s.id)).toEqual([
      "Each_Person_smokes",
      "Smoker_is_a_subtype_of_Person",
    ]);
  });

  it("are found from a model the caller already loaded, without loading the file again", () => {
    const model = read(typed);
    const spy = vi.spyOn(OrmYamlSerializer.prototype, "deserialize");
    try {
      expect(storeIds(typed, model)).toEqual(storeIds(typed));
      // Once, for the call without a model; none for the call with one.
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("leave a file that states every id as it is", () => {
    const { text } = storeIds(typed);
    expect(storeIds(text)).toEqual({ text, stored: [] });
  });

  it("are none in a file before 4.0, which states no 4.0 id at all", () => {
    const v3 = `orm_version: "3.0"
model:
  name: M
  object_types:
    - { id: u1, name: Person, kind: entity, reference_mode: nr }
`;
    expect(read(v3).unstoredIds).toEqual([]);
    expect(storeIds(v3)).toEqual({ text: v3, stored: [] });
  });
});

describe("a file before 4.0", () => {
  it("gets one note, at no element, saying its ids are 4.0's and naming migrate", () => {
    const v3 = `orm_version: "3.0"
model:
  name: M
  object_types:
    - { id: u1, name: Person, kind: entity, reference_mode: nr }
    - { id: u2, name: Car, kind: entity, reference_mode: vin }
`;
    const notes = new ValidationEngine().validate(read(v3))
      .filter((d) => d.ruleId === "structural/replayed-ids");
    expect(notes.map((d) => [d.severity, d.elementId])).toEqual([["info", ""]]);
    expect(notes[0]!.message).toContain("barwise migrate");
    expect(ruleIds(typed)).not.toContain("structural/replayed-ids");
  });
});

describe("a shadow replayed with its owner's id", () => {
  const shadow = `orm_version: "3.0"
model:
  name: billing
  domain_context: billing
  object_types:
    - { id: s1, name: Order Line, kind: entity, reference_mode: nr, source_context: sales }
`;

  it("names the owner by its local name when nothing says otherwise", () => {
    expect(read(shadow).objectTypes[0]!.id).toBe("sales:Order_Line");
  });

  it("names the id the owner's domain gives, a suffixed one included", () => {
    const ownerId = (context: string, name: string) =>
      context === "sales" && name === "Order Line" ? "Order_Line_2" : undefined;
    const { model } = serializer.migrate(shadow, { lenient: true, ownerId });
    expect(model.objectTypes[0]!.id).toBe("sales:Order_Line_2");
    expect(model.priorIds?.get("sales:Order_Line_2")).toBe("s1");
  });
});
