/**
 * Diff recognizes a rename by content (iri-identity 6a, decision 8): an
 * object type or fact type that ids and names left unpaired pairs with
 * the one element on the other side that says the same thing, and the
 * delta carries `pairedBy: "recognized"`. Merge refuses such a pair, and a
 * declared one, and a diff whose ids said nothing.
 *
 * The two models in each case have unrelated ids, as two imports of one
 * schema do: on one file's revisions a rename keeps its id and pairs by it.
 *
 * Spec: docs/specs/iri-identity.spec.md, WS6 6a.
 */
import { describe, expect, it } from "vitest";
import { deltaToJson, pairingNote } from "../../src/diff/deltas.js";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { MERGE_DIFF_OPTIONS, mergeAndValidate, mergeModels } from "../../src/diff/ModelMerge.js";
import { OrmModel } from "../../src/model/OrmModel.js";

interface Names {
  readonly customer?: string;
  readonly order?: string;
  readonly places?: string;
  readonly role?: string;
}

/**
 * Customer places Order, with a uniqueness and a mandatory, and Order has
 * Amount, under ids prefixed by `p` so two models' ids never coincide.
 */
function shop(p: string, n: Names = {}): OrmModel {
  const m = new OrmModel({ name: "Shop" });
  m.addObjectType({
    id: `${p}c`,
    name: n.customer ?? "Customer",
    kind: "entity",
    referenceMode: "nr",
  });
  m.addObjectType({ id: `${p}o`, name: n.order ?? "Order", kind: "entity", referenceMode: "nr" });
  m.addObjectType({ id: `${p}a`, name: "Amount", kind: "value" });
  m.addFactType({
    id: `${p}f`,
    name: n.places ?? "Customer places Order",
    roles: [
      { id: `${p}r0`, name: n.role ?? "places", playerId: `${p}c` },
      { id: `${p}r1`, name: "placed by", playerId: `${p}o` },
    ],
    readings: ["{0} places {1}"],
    constraints: [
      { type: "internal_uniqueness", id: `${p}u`, roleIds: [`${p}r1`] },
      { type: "mandatory", id: `${p}m`, roleId: `${p}r1` },
    ],
  });
  m.addFactType({
    id: `${p}g`,
    name: "Order has Amount",
    roles: [
      { id: `${p}g0`, name: "has", playerId: `${p}o` },
      { id: `${p}g1`, name: "is of", playerId: `${p}a` },
    ],
    readings: ["{0} has {1}"],
  });
  return m;
}

const named = (diff: ReturnType<typeof diffModels>, type: "object_type" | "fact_type") =>
  diff.deltas.filter((d) => d.elementType === type && d.kind !== "unchanged");

describe("a rename the diff recognizes", () => {
  it("pairs a renamed object type by the roles it plays", () => {
    const diff = diffModels(shop("a"), shop("b", { customer: "Client" }));
    expect(named(diff, "object_type")).toEqual([
      expect.objectContaining({
        kind: "modified",
        name: "Customer",
        pairedBy: "recognized",
        changes: [{ change: "name", from: "Customer", to: "Client" }],
      }),
    ]);
    // The fact type it plays in pairs by name and, with its player paired,
    // is unchanged: a recognized rename is one change, not a cascade.
    expect(named(diff, "fact_type")).toEqual([]);
  });

  it("pairs a renamed fact type by its players, role names and constraints", () => {
    const diff = diffModels(shop("a"), shop("b", { places: "Customer submits Order" }));
    expect(named(diff, "fact_type")).toEqual([
      expect.objectContaining({ kind: "modified", pairedBy: "recognized" }),
    ]);
    expect(named(diff, "object_type")).toEqual([]);
    // Its constraints follow the pair: nothing reads as removed and added.
    expect(diff.deltas.filter((d) => d.elementType === "constraint" && d.kind !== "unchanged"))
      .toEqual([]);
  });

  it("is reported on the JSON and in one text line", () => {
    const diff = diffModels(shop("a"), shop("b", { customer: "Client" }));
    const delta = named(diff, "object_type")[0]!;
    expect(deltaToJson(delta).pairedBy).toBe("recognized");
    expect(pairingNote(delta)).toBe(
      "Possibly a rename: paired by what it says, not by its id or name.",
    );
  });

  it("marks nothing on a pair by id or by name", () => {
    const diff = diffModels(shop("a"), shop("b"));
    for (const d of diff.deltas) {
      expect(deltaToJson(d).pairedBy).toBeUndefined();
      expect(pairingNote(d)).toBeUndefined();
    }
    const byName = diff.deltas.find((d) => d.elementType === "object_type");
    expect(byName).toEqual(expect.objectContaining({ pairedBy: "name" }));
    const byId = diffModels(shop("a"), shop("a", { customer: "Client" })).deltas
      .find((d) => d.elementType === "object_type" && d.kind === "modified");
    expect(byId).toEqual(expect.objectContaining({ pairedBy: "id" }));
  });

  it("is rated no lower than the removal it stands in for", () => {
    // It may be two elements of one shape, so a reader told "safe" would
    // know less than the unpaired diff told them: a removal is breaking.
    const recognized = named(
      diffModels(shop("a"), shop("b", { customer: "Client" })),
      "object_type",
    );
    expect(recognized[0]!.breakingLevel).toBe("breaking");
    const unpaired = named(
      diffModels(shop("a"), shop("b", { customer: "Client" }), { recognizeRenames: false }),
      "object_type",
    );
    expect(unpaired.find((d) => d.kind === "removed")!.breakingLevel).toBe("breaking");
  });

  it("is not done when recognizeRenames is off", () => {
    const diff = diffModels(shop("a"), shop("b", { customer: "Client" }), {
      recognizeRenames: false,
    });
    expect(named(diff, "object_type").map((d) => d.kind).sort()).toEqual(["added", "removed"]);
  });
});

describe("what the content pass leaves alone", () => {
  it("pairs nothing when two elements on one side share a key", () => {
    // Two subtypes of one supertype that play no role say the same thing:
    // a key two elements share pairs nothing, on either side.
    const subtypes = (p: string, names: readonly string[]) => {
      const m = new OrmModel({ name: "M" });
      m.addObjectType({ id: `${p}h`, name: "Person", kind: "entity", referenceMode: "nr" });
      for (const [i, name] of names.entries()) {
        m.addObjectType({ id: `${p}${i}`, name, kind: "entity", referenceMode: "nr" });
        m.addSubtypeFact({ id: `${p}s${i}`, subtypeId: `${p}${i}`, supertypeId: `${p}h` });
      }
      return m;
    };
    const ambiguous = diffModels(
      subtypes("a", ["Driver", "Rider"]),
      subtypes("b", ["Pilot", "Guest"]),
    );
    expect(named(ambiguous, "object_type").map((d) => d.kind).sort())
      .toEqual(["added", "added", "removed", "removed"]);
    // With one on each side, the same key pairs them.
    const single = diffModels(subtypes("a", ["Driver"]), subtypes("b", ["Pilot"]));
    expect(named(single, "object_type")).toEqual([
      expect.objectContaining({ kind: "modified", pairedBy: "recognized" }),
    ]);
  });

  it("never pairs an object type that plays no role and ends no subtype fact", () => {
    const lone = (p: string, name: string) => {
      const m = new OrmModel({ name: "M" });
      m.addObjectType({ id: `${p}x`, name, kind: "value" });
      return m;
    };
    const diff = diffModels(lone("a", "Email"), lone("b", "Phone"));
    expect(named(diff, "object_type").map((d) => d.kind).sort()).toEqual(["added", "removed"]);
  });

  it("cannot recognize an object type renamed together with a fact type it plays in", () => {
    // The stated limit: the object type's key holds the renamed fact
    // type's side-tagged key, and the fact type's key holds the renamed
    // object type's, so neither pairs, in either order.
    const diff = diffModels(
      shop("a"),
      shop("b", { customer: "Client", places: "Client submits Order" }),
    );
    expect(named(diff, "object_type").map((d) => d.kind).sort()).toEqual(["added", "removed"]);
    expect(named(diff, "fact_type").map((d) => d.kind).sort()).toEqual(["added", "removed"]);
  });

  it("does not pair a renamed fact type whose role name also changed", () => {
    const diff = diffModels(
      shop("a"),
      shop("b", { places: "Customer submits Order", role: "submits" }),
    );
    expect(named(diff, "fact_type").map((d) => d.kind).sort()).toEqual(["added", "removed"]);
  });
});

describe("a declared rename", () => {
  const changed = () => shop("b", { places: "Customer submits Order", role: "submits" });

  it("refuses a kind it does not know, as a tool call can send", () => {
    // "object-type" is the CLI's spelling; read as anything but an error it
    // would be applied as a fact-type rename.
    const target = { kind: "object-type", name: "Customer" } as never;
    expect(() => diffModels(shop("a"), changed(), { renames: [{ target, to: "Customer" }] }))
      .toThrow(/kind must be objectType or factType, not "object-type"/);
  });

  it("pairs what the content pass cannot", () => {
    const diff = diffModels(shop("a"), changed(), {
      renames: [{
        target: { kind: "factType", name: "Customer places Order" },
        to: "Customer submits Order",
      }],
    });
    expect(named(diff, "fact_type")).toEqual([
      expect.objectContaining({ kind: "modified", pairedBy: "declared" }),
    ]);
    expect(pairingNote(named(diff, "fact_type")[0]!)).toBe("Paired as a declared rename.");
  });

  it.each(
    [
      [
        { kind: "factType", name: "Nobody" },
        "Customer submits Order",
        /existing model has no fact type named "Nobody"/,
      ],
      [
        { kind: "factType", name: "Customer places Order" },
        "Nobody",
        /incoming model has no fact type named "Nobody"/,
      ],
      [{ kind: "objectType", name: "Amount" }, "Customer", /already paired/],
    ] as const,
  )("refuses %j -> %j", (target, to, reason) => {
    expect(() => diffModels(shop("a"), changed(), { renames: [{ target, to }] })).toThrow(reason);
  });
});

describe("merge refuses a pairing that is not evidence", () => {
  it("refuses two entity types of one shape that the diff paired as a rename", () => {
    // A transcript's new Supplier beside the base's Vendor: one shape, two
    // elements. Diff may say "possible rename"; merge must not fold them.
    const existing = shop("a", { customer: "Vendor" });
    const incoming = shop("b", { customer: "Supplier" });
    const diff = diffModels(existing, incoming);
    expect(named(diff, "object_type")[0]).toEqual(
      expect.objectContaining({ pairedBy: "recognized" }),
    );
    expect(() => mergeModels(existing, incoming, diff, new Set(diff.deltas.keys())))
      .toThrow(/rename recognition on.*MERGE_DIFF_OPTIONS/s);
    const result = mergeAndValidate(existing, incoming, diff, new Set(diff.deltas.keys()));
    expect(result.model).toBeNull();
    expect(result.diagnostics[0]!.message).toMatch(/rename recognition on/);
  });

  it("refuses a diff built with recognition on even when it found no pair", () => {
    // So a merge path that forgot MERGE_DIFF_OPTIONS fails on every input,
    // not only on one that happens to hold two elements of one shape.
    const diff = diffModels(shop("a"), shop("b"));
    expect(diff.deltas.some((d) => "pairedBy" in d && d.pairedBy === "recognized")).toBe(false);
    expect(() => mergeModels(shop("a"), shop("b"), diff, new Set())).toThrow(
      /rename recognition on/,
    );
  });

  it("refuses a declared rename", () => {
    const existing = shop("a");
    const incoming = shop("b", { places: "Customer submits Order", role: "submits" });
    const diff = diffModels(existing, incoming, {
      ...MERGE_DIFF_OPTIONS,
      renames: [{
        target: { kind: "factType", name: "Customer places Order" },
        to: "Customer submits Order",
      }],
    });
    expect(() => mergeModels(existing, incoming, diff, new Set())).toThrow(
      /pairs elements as renames \("Customer places Order"\)/,
    );
  });

  it("refuses a diff built with matching: content", () => {
    const diff = diffModels(shop("a"), shop("b"), { ...MERGE_DIFF_OPTIONS, matching: "content" });
    expect(() => mergeModels(shop("a"), shop("b"), diff, new Set())).toThrow(/matching: "content"/);
  });

  it("merges the same models diffed as every merge path diffs them", () => {
    const existing = shop("a", { customer: "Vendor" });
    const incoming = shop("b", { customer: "Supplier" });
    const diff = diffModels(existing, incoming, MERGE_DIFF_OPTIONS);
    const accepted = new Set(diff.deltas.flatMap((d, i) => (d.kind === "added" ? [i] : [])));
    const merged = mergeModels(existing, incoming, diff, accepted);
    expect(merged.objectTypes.map((o) => o.name).sort()).toEqual(
      ["Amount", "Order", "Supplier", "Vendor"],
    );
  });
});
