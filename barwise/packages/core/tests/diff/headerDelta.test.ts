/**
 * The model header in diff and merge (iri-identity WS6, 6b-3c): an edit to
 * `namespace` or `imports` changes no id and no pairing, so the header is
 * its own delta, and a merge that accepts it takes the incoming header.
 */
import { describe, expect, it } from "vitest";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { MERGE_DIFF_OPTIONS, mergeModels } from "../../src/diff/ModelMerge.js";
import { OrmModel } from "../../src/model/OrmModel.js";

const model = (config: { namespace?: string; imports?: Record<string, string>; } = {}) => {
  const m = new OrmModel({ name: "Shop", idsAcrossKinds: true, ...config });
  m.addObjectType({ id: "Customer", name: "Customer", kind: "entity", referenceMode: "nr" });
  return m;
};
const header = (a: OrmModel, b: OrmModel) =>
  diffModels(a, b, MERGE_DIFF_OPTIONS).deltas.find((d) => d.elementType === "model_header")!;

describe("the model header delta", () => {
  it("never removes a namespace or an import, as a transcript import's header would", () => {
    // Every surface accepts all added and modified deltas without asking.
    const base = model({ namespace: "https://a.example/", imports: { crm: "crm" } });
    const transcript = model();
    const diff = diffModels(base, transcript, MERGE_DIFF_OPTIONS);
    const all = new Set(diff.deltas.flatMap((d, i) => (d.kind === "modified" ? [i] : [])));
    expect(all.size).toBeGreaterThan(0);
    const merged = mergeModels(base, transcript, diff, all);
    expect([merged.namespace, [...merged.imports]]).toEqual(["https://a.example/", [[
      "crm",
      "crm",
    ]]]);
  });

  it("is unchanged, first, and leaves hasChanges alone when the headers agree", () => {
    const same = { namespace: "https://a.example/", imports: { crm: "crm" } };
    const diff = diffModels(model(same), model(same));
    expect(diff.deltas[0]).toMatchObject({ elementType: "model_header", kind: "unchanged" });
    expect(diff.hasChanges).toBe(false);
  });

  it("reports a namespace and each import added, rebound or removed, as caution", () => {
    const before = model({ namespace: "https://a.example/", imports: { crm: "crm", hr: "hr" } });
    const after = model({ namespace: "https://b.example/", imports: { crm: "sales", ops: "ops" } });
    const d = header(before, after);
    expect([d.kind, d.breakingLevel]).toEqual(["modified", "caution"]);
    expect(d.changeDescriptions).toEqual([
      'namespace: "https://a.example/" -> "https://b.example/"',
      'import "crm": "crm" -> "sales"',
      'import "hr": "hr" -> "(none)"',
      'import "ops": "(none)" -> "ops"',
    ]);
    expect(diffModels(before, after).hasChanges).toBe(true);
  });

  it("is taken by a merge that accepts it, and left when it does not", () => {
    const before = model({ namespace: "https://a.example/", imports: { crm: "crm", hr: "hr" } });
    const after = model({ namespace: "https://b.example/", imports: { crm: "sales", ops: "ops" } });
    const diff = diffModels(before, after, MERGE_DIFF_OPTIONS);
    const index = diff.deltas.findIndex((d) => d.elementType === "model_header");
    const taken = mergeModels(before, after, diff, new Set([index]));
    // Rebound and added; "hr", which the incoming side lacks, stays.
    expect([taken.namespace, [...taken.imports]]).toEqual([
      "https://b.example/",
      [["crm", "sales"], ["hr", "hr"], ["ops", "ops"]],
    ]);
    // Not accepted: the rebinding of "crm" is a clash the merge refuses.
    expect(() => mergeModels(before, after, diff, new Set())).toThrow(/the alias "crm" is bound/);
    const quiet = model({ namespace: "https://b.example/" });
    const kept = mergeModels(
      before,
      quiet,
      diffModels(before, quiet, MERGE_DIFF_OPTIONS),
      new Set(),
    );
    expect([kept.namespace, [...kept.imports]]).toEqual([
      "https://a.example/",
      [["crm", "crm"], ["hr", "hr"]],
    ]);
  });
});
