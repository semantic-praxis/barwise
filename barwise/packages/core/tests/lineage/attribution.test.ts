/**
 * Which model each lineage export belongs to (iri-identity, WS6 6a). A
 * manifest serves every model in its directory; an export names its own
 * model, and one written before exports did is attributed to a model that
 * holds every source id and owns at least one -- a shadow holds its
 * owner's id and does not own it.
 *
 * Spec: docs/specs/iri-identity.spec.md, WS6 6a, "Lineage exports name
 * their model".
 */
import { describe, expect, it } from "vitest";
import {
  claimExports,
  claimsExport,
  exportModels,
  exportsForModel,
} from "../../src/lineage/attribution.js";
import { analyzeImpact } from "../../src/lineage/impact.js";
import { hashModel, updateManifest } from "../../src/lineage/manifest.js";
import { resolveArtifactInManifest } from "../../src/lineage/resolveArtifact.js";
import { checkStaleness } from "../../src/lineage/staleness.js";
import type { LineageManifest, ManifestExport } from "../../src/lineage/types.js";
import { OrmModel } from "../../src/model/OrmModel.js";

// Built on `OrmModel` directly: the exports below name element ids, and
// which domain holds which id is what the tests vary.

/** Sales owns Customer, Order and "Customer places Order". */
function sales(): OrmModel {
  const m = new OrmModel({ name: "Sales" });
  m.addObjectType({ id: "cust", name: "Customer", kind: "entity", referenceMode: "nr" });
  m.addObjectType({ id: "ord", name: "Order", kind: "entity", referenceMode: "nr" });
  m.addFactType({
    id: "places",
    name: "Customer places Order",
    roles: [
      { id: "places-0", name: "places", playerId: "cust" },
      { id: "places-1", name: "is placed by", playerId: "ord" },
    ],
    readings: ["{0} places {1}"],
  });
  return m;
}

/** Billing shadows Sales' Customer, as split leaves it, and owns Invoice. */
function billing(): OrmModel {
  const m = new OrmModel({ name: "Billing" });
  m.addObjectType({
    id: "cust",
    name: "Customer",
    kind: "entity",
    referenceMode: "nr",
    sourceContext: "Sales",
  });
  m.addObjectType({ id: "inv", name: "Invoice", kind: "entity", referenceMode: "nr" });
  m.addFactType({
    id: "billed",
    name: "Invoice bills Customer",
    roles: [
      { id: "billed-0", name: "bills", playerId: "inv" },
      { id: "billed-1", name: "is billed by", playerId: "cust" },
    ],
    readings: ["{0} bills {1}"],
  });
  return m;
}

const src = (elementId: string) => ({
  elementId,
  elementType: "EntityType" as const,
  elementName: elementId,
});

function exp(artifact: string, ids: string[], more: Partial<ManifestExport> = {}): ManifestExport {
  return {
    artifact,
    format: "ddl",
    exportedAt: "2026-10-29T00:00:00Z",
    modelHash: "h",
    sources: ids.map(src),
    ...more,
  };
}

/** Sales and Billing share a directory, so neither is alone in it. */
const shared = (sourceModel: string) => ({
  sourceModel,
  modelsBeside: ["billing.orm.yaml", "sales.orm.yaml"],
});

function manifest(exports: ManifestExport[]): LineageManifest {
  return { version: 1, sourceModel: "billing.orm.yaml", sourceModelHash: "h", exports };
}

describe("claiming an export that names no model", () => {
  it("is the owner's: it holds every source id and owns one", () => {
    expect(claimsExport(sales(), exp("orders.sql", ["cust", "ord", "places"]))).toBe(true);
  });

  it("is not a domain's that only shadows the type", () => {
    // Billing holds `cust`, through its shadow, and owns none of these.
    expect(claimsExport(billing(), exp("customers.sql", ["cust"]))).toBe(false);
  });

  it("is a domain's whose own export references a shadow", () => {
    expect(claimsExport(billing(), exp("invoices.sql", ["inv", "cust", "billed"]))).toBe(true);
  });

  it("is nobody's when the model lacks a source id, or there are no sources", () => {
    expect(claimsExport(sales(), exp("gone.sql", ["cust", "deleted"]))).toBe(false);
    expect(claimsExport(sales(), exp("nolineage.sql", []))).toBe(false);
  });

  it("does not move an export that already names a model", () => {
    const named = exp("orders.sql", ["cust"], { sourceModel: "other.orm.yaml" });
    expect(claimsExport(sales(), named)).toBe(false);
  });

  it("stamps what it claims, says which, and leaves the rest", () => {
    const m = manifest([exp("orders.sql", ["ord"]), exp("customers.sql", ["inv"])]);
    const { manifest: stamped, claimed } = claimExports(m, shared("sales.orm.yaml"), sales());
    expect(stamped.exports.map((e) => e.sourceModel)).toEqual(["sales.orm.yaml", undefined]);
    expect(claimed.map((e) => e.artifact)).toEqual(["orders.sql"]);
  });

  it("is every unnamed export's, sources or none, for a model alone in its directory", () => {
    // The manifest can serve no other model, so an export with no sources,
    // or listing an element since deleted, is still this model's.
    const m = manifest([exp("nolineage.sql", []), exp("gone.sql", ["deleted"])]);
    const alone = { sourceModel: "sales.orm.yaml", modelsBeside: ["sales.orm.yaml"] };
    expect(claimExports(m, alone, sales()).claimed.map((e) => e.artifact)).toEqual([
      "nolineage.sql",
      "gone.sql",
    ]);
    expect(exportsForModel(m, alone, sales()).unattributed).toEqual([]);
  });
});

describe("one model's exports", () => {
  const m = manifest([
    exp("orders.sql", ["ord"], { sourceModel: "sales.orm.yaml" }),
    exp("invoices.sql", ["inv"], { sourceModel: "billing.orm.yaml" }),
    exp("legacy-orders.sql", ["cust", "ord"]),
    exp("nolineage.sql", []),
  ]);

  it("are those naming it, and those it claims; another model's are in neither list", () => {
    const { own, unattributed } = exportsForModel(m, shared("sales.orm.yaml"), sales());
    expect(own.map((e) => e.artifact)).toEqual(["orders.sql", "legacy-orders.sql"]);
    expect(unattributed.map((e) => e.artifact)).toEqual(["nolineage.sql"]);
  });

  it("reports an export whose named model file is gone", () => {
    // A renamed model's exports still name its old file.
    const renamed = {
      sourceModel: "store.orm.yaml",
      modelsBeside: ["billing.orm.yaml", "store.orm.yaml"],
    };
    expect(exportsForModel(m, renamed, sales()).orphaned.map((e) => e.artifact)).toEqual([
      "orders.sql",
    ]);
    expect(checkStaleness(m, sales(), renamed).orphanedArtifacts).toEqual(["orders.sql"]);
    expect(exportsForModel(m, shared("sales.orm.yaml"), sales()).orphaned).toEqual([]);
  });

  it("refuses a model the directory does not list under that name", () => {
    // A symlink or another letter case would match none of its exports and
    // report no artifacts, a stale one passing silently.
    const alias = {
      sourceModel: "Sales.orm.yaml",
      modelsBeside: ["billing.orm.yaml", "sales.orm.yaml"],
    };
    const refused = /"Sales\.orm\.yaml" is not one of the model files beside its manifest/;
    expect(() => exportsForModel(m, alias, sales())).toThrow(refused);
    expect(() => checkStaleness(m, sales(), alias)).toThrow(refused);
    expect(() => claimExports(m, alias, sales())).toThrow(refused);
    expect(() => analyzeImpact(m, "cust", alias)).toThrow(refused);
  });

  it("names the models the exports name, sorted", () => {
    expect(exportModels(m)).toEqual(["billing.orm.yaml", "sales.orm.yaml"]);
  });

  it("are what staleness reads, with the unattributed listed apart", () => {
    const model = sales();
    const fresh = hashModel(model);
    const withHash = manifest([
      exp("orders.sql", ["ord"], { sourceModel: "sales.orm.yaml", modelHash: fresh }),
      exp("invoices.sql", ["inv"], { sourceModel: "billing.orm.yaml", modelHash: "old" }),
      exp("legacy-orders.sql", ["cust", "ord"], { modelHash: "old" }),
      exp("nolineage.sql", [], { modelHash: fresh }),
    ]);
    const report = checkStaleness(withHash, model, shared("sales.orm.yaml"));
    expect(report.freshArtifacts).toEqual(["orders.sql"]);
    expect(report.staleArtifacts.map((s) => s.artifact)).toEqual(["legacy-orders.sql"]);
    expect(report.unattributedArtifacts).toEqual(["nolineage.sql"]);
  });

  it("are all of them when no model file is named, as before", () => {
    const report = checkStaleness(m, sales());
    expect(report.staleArtifacts).toHaveLength(4);
    expect(report.unattributedArtifacts).toEqual([]);
  });
});

describe("impact over a shared manifest", () => {
  // Two models can each have an element with one id once ids are local
  // names; here both exports hold `cust`.
  const m = manifest([
    exp("orders.sql", ["cust"], { sourceModel: "sales.orm.yaml" }),
    exp("invoices.sql", ["cust"], { sourceModel: "billing.orm.yaml" }),
    exp("legacy.sql", ["cust"]),
  ]);

  it("reads only the named model's exports, and those naming none", () => {
    const report = analyzeImpact(m, "cust", shared("sales.orm.yaml"));
    expect(report.affectedArtifacts.map((a) => [a.artifact, a.sourceModel])).toEqual([
      ["orders.sql", "sales.orm.yaml"],
      ["legacy.sql", undefined],
    ]);
  });

  it("reads an export naming a model file that is gone, likely this model's before a rename", () => {
    const renamed = {
      sourceModel: "store.orm.yaml",
      modelsBeside: ["billing.orm.yaml", "store.orm.yaml"],
    };
    expect(analyzeImpact(m, "cust", renamed).affectedArtifacts.map((a) => a.artifact)).toEqual([
      "orders.sql",
      "legacy.sql",
    ]);
  });

  it("reads every export without a model, naming each one's", () => {
    const report = analyzeImpact(m, "cust");
    expect(report.affectedArtifacts.map((a) => a.sourceModel)).toEqual([
      "sales.orm.yaml",
      "billing.orm.yaml",
      undefined,
    ]);
  });
});

describe("writing and resolving", () => {
  it("records the model on the export it writes", () => {
    const written = updateManifest(exp("orders.sql", ["ord"]), undefined, "sales.orm.yaml");
    expect(written.exports[0]!.sourceModel).toBe("sales.orm.yaml");
    const again = updateManifest(exp("invoices.sql", ["inv"]), written, "billing.orm.yaml");
    expect(again.exports.map((e) => e.sourceModel)).toEqual(["sales.orm.yaml", "billing.orm.yaml"]);
  });

  it("resolves an artifact to its export's model, not the last to export", () => {
    const m = manifest([exp("/w/orders.sql", ["ord"], { sourceModel: "sales.orm.yaml" })]);
    expect(resolveArtifactInManifest(m, "/w/orders.sql", "/w")?.sourceModel).toBe("sales.orm.yaml");
    const legacy = manifest([exp("/w/orders.sql", ["ord"])]);
    expect(resolveArtifactInManifest(legacy, "/w/orders.sql", "/w")?.sourceModel).toBe(
      "billing.orm.yaml",
    );
  });
});
