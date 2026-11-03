/**
 * The model header in diff and merge (iri-identity WS6, 6b-3c): an edit to
 * `namespace` or `imports` changes no id and no pairing, so each part of
 * the header is a delta of its own, added, removed or modified like any
 * element, and a merge applies the ones accepted by their kind.
 */
import { describe, expect, it } from "vitest";
import type { ModelDelta } from "../../src/diff/deltas.js";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { MERGE_DIFF_OPTIONS, mergeModels } from "../../src/diff/ModelMerge.js";
import { OrmModel } from "../../src/model/OrmModel.js";

const model = (config: { namespace?: string; imports?: Record<string, string>; } = {}) => {
  const m = new OrmModel({ name: "Shop", idsAcrossKinds: true, ...config });
  m.addObjectType({ id: "Customer", name: "Customer", kind: "entity", referenceMode: "nr" });
  return m;
};
const headers = (deltas: readonly ModelDelta[]) =>
  deltas.filter((d) => d.elementType === "model_header");
/** What every surface's non-interactive merge accepts: added and modified. */
const surfacePolicy = (deltas: readonly ModelDelta[]) =>
  new Set(deltas.flatMap((d, i) => (d.kind === "added" || d.kind === "modified" ? [i] : [])));

describe("the model header deltas", () => {
  it("are none when the headers agree, so a diff of equal models has no changes", () => {
    const same = { namespace: "https://a.example/", imports: { crm: "crm" } };
    const diff = diffModels(model(same), model(same));
    expect(headers(diff.deltas)).toEqual([]);
    expect(diff.hasChanges).toBe(false);
  });

  it("are one per part, each added, removed or modified, first in the diff", () => {
    const before = model({ namespace: "https://a.example/", imports: { crm: "crm", hr: "hr" } });
    const after = model({ imports: { crm: "sales", ops: "ops" } });
    const diff = diffModels(before, after);
    expect(diff.deltas.slice(0, 4).map((d) => [d.elementType, d.kind, d.changeDescriptions]))
      .toEqual([
        ["model_header", "removed", ['namespace: "https://a.example/" -> "(none)"']],
        ["model_header", "modified", ['import "crm": "crm" -> "sales"']],
        ["model_header", "removed", ['import "hr": "hr" -> "(none)"']],
        ["model_header", "added", ['import "ops": "(none)" -> "ops"']],
      ]);
    expect(headers(diff.deltas).map((d) => d.breakingLevel)).toEqual([
      "caution",
      "caution",
      "caution",
      "safe",
    ]);
  });
});

describe("a merge of header deltas", () => {
  it("takes additions under the surfaces' policy, and leaves removals, as a transcript's would be", () => {
    // A transcript import has no namespace and no imports of its own.
    const base = model({ namespace: "https://a.example/", imports: { crm: "crm" } });
    const transcript = model({ imports: { ops: "ops" } });
    const diff = diffModels(base, transcript, MERGE_DIFF_OPTIONS);
    const merged = mergeModels(base, transcript, diff, surfacePolicy(diff.deltas));
    expect([merged.namespace, [...merged.imports]]).toEqual([
      "https://a.example/",
      [["crm", "crm"], ["ops", "ops"]],
    ]);
  });

  it("takes a removal a person accepted", () => {
    const base = model({ namespace: "https://a.example/", imports: { crm: "crm", hr: "hr" } });
    const incoming = model({ imports: { crm: "crm" } });
    const diff = diffModels(base, incoming, MERGE_DIFF_OPTIONS);
    const all = new Set(diff.deltas.map((_, i) => i));
    const merged = mergeModels(base, incoming, diff, all);
    expect([merged.namespace, [...merged.imports]]).toEqual([undefined, [["crm", "crm"]]]);
  });

  it("takes a namespace changed on the incoming side when that delta is accepted", () => {
    const base = model({ namespace: "https://a.example/" });
    const incoming = model({ namespace: "https://b.example/" });
    const diff = diffModels(base, incoming, MERGE_DIFF_OPTIONS);
    expect(mergeModels(base, incoming, diff, surfacePolicy(diff.deltas)).namespace).toBe(
      "https://b.example/",
    );
    expect(mergeModels(base, incoming, diff, new Set()).namespace).toBe("https://a.example/");
  });

  it("refuses a rebound alias, accepted or not, since the base's shadows would change meaning", () => {
    const base = model({ imports: { x: "crm" } });
    const incoming = model({ imports: { x: "billing" } });
    const diff = diffModels(base, incoming, MERGE_DIFF_OPTIONS);
    for (const accepted of [surfacePolicy(diff.deltas), new Set<number>()]) {
      expect(() => mergeModels(base, incoming, diff, accepted)).toThrow(
        /the alias "x" is bound to "crm" in the base and to "billing" in the incoming model/,
      );
    }
  });

  it("gives an accepted incoming shadow its import even when the header delta is not taken", () => {
    const base = model();
    const incoming = model({ imports: { crm: "crm" } });
    incoming.addObjectType({ id: "crm:Lead", name: "Lead", kind: "entity", referenceMode: "nr" });
    const diff = diffModels(base, incoming, MERGE_DIFF_OPTIONS);
    const lead = diff.deltas.findIndex((d) =>
      d.elementType === "object_type" && d.kind === "added"
    );
    const merged = mergeModels(base, incoming, diff, new Set([lead]));
    expect([...merged.imports]).toEqual([["crm", "crm"]]);
  });
});
