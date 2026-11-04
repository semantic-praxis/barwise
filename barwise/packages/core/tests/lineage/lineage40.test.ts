/**
 * Lineage under format 4.0 (iri-identity 6e): a manifest goes to version 2,
 * an export a version 1 manifest held is marked as written under 3.x ids
 * and reads stale for that reason, impact names such exports rather than
 * returning nothing, and a rename rewrites the lineage it can see without
 * restamping the hash.
 */
import { describe, expect, it } from "vitest";
import { analyzeImpact } from "../../src/lineage/impact.js";
import {
  hashModel,
  parseManifest,
  renameInManifest,
  serializeManifest,
  updateManifest,
} from "../../src/lineage/manifest.js";
import { checkStaleness } from "../../src/lineage/staleness.js";
import type { LineageManifest, ManifestExport } from "../../src/lineage/types.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmProject } from "../../src/model/OrmProject.js";
import { renameInModel } from "../../src/rename/renameInModel.js";
import { renameInProject } from "../../src/rename/renameInProject.js";
import {
  lineageRenameWrites,
  modelLineageRenames,
  projectLineageRenames,
} from "../../src/rename/surfaceSupport.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";

const shop = () => {
  const m = new OrmModel({ name: "Shop" });
  m.addObjectType({ name: "Customer", kind: "entity", referenceMode: "nr" });
  return m;
};

const exported = (artifact: string, elementId: string, hash: string): ManifestExport => ({
  artifact,
  format: "ddl",
  exportedAt: "2026-11-04T00:00:00Z",
  modelHash: hash,
  sources: [{ elementId, elementType: "EntityType", elementName: "Customer" }],
  sourceModel: "shop.orm.yaml",
});

/** A manifest as a build before 4.0 wrote it, read back. */
const version1 = (...exports: ManifestExport[]) =>
  parseManifest(
    serializeManifest({ version: 1, sourceModel: "shop.orm.yaml", sourceModelHash: "", exports }),
  );

describe("a version 1 manifest", () => {
  it("reads as version 2, every export marked as written under 3.x ids", () => {
    const m = version1(exported("a.sql", "ot-1", "h"));
    expect(m.version).toBe(2);
    expect(m.exports.map((e) => e.idsBefore40)).toEqual([true]);
  });

  it("keeps each export it does not replace marked when a 4.0 build writes it", () => {
    const old = version1(exported("a.sql", "ot-1", "h"), exported("b.sql", "ot-1", "h"));
    const next = updateManifest(exported("a.sql", "Customer", hashModel(shop())), old);
    expect(next.version).toBe(2);
    expect(next.exports.map((e) => [e.artifact, e.idsBefore40 ?? false])).toEqual([
      ["a.sql", false],
      ["b.sql", true],
    ]);
  });

  it("is upgraded by updateManifest when handed unparsed, as a caller holding one in memory does", () => {
    const raw: LineageManifest = {
      version: 1,
      sourceModel: "shop.orm.yaml",
      sourceModelHash: "",
      exports: [exported("b.sql", "ot-1", "h")],
    };
    const next = updateManifest(exported("a.sql", "Customer", "h"), raw);
    expect(next.version).toBe(2);
    expect(next.exports.map((e) => [e.artifact, e.idsBefore40 ?? false])).toEqual([
      ["b.sql", true],
      ["a.sql", false],
    ]);
  });

  it("is never marked when it is already version 2", () => {
    const m = parseManifest(
      serializeManifest(updateManifest(exported("a.sql", "Customer", "h"), undefined)),
    );
    expect(m.exports.map((e) => e.idsBefore40)).toEqual([undefined]);
  });
});

describe("an export written under 3.x ids", () => {
  it("is stale for that reason, even where its hash would match", () => {
    const model = shop();
    const m = version1(exported("a.sql", "Customer", hashModel(model)));
    const report = checkStaleness(m, model);
    expect(report.staleArtifacts.map((s) => s.reason)).toEqual([
      "ids changed to 4.0: exported under 3.x ids; re-export it",
    ]);
    expect(report.freshArtifacts).toEqual([]);
  });

  it("is named by impact analysis when its sources hold no id the element is known by", () => {
    const m = version1(exported("a.sql", "ot-1", "h"));
    const report = analyzeImpact(m, "Customer");
    expect(report.affectedArtifacts).toEqual([]);
    expect(report.exportsBefore40).toEqual(["a.sql"]);
  });
});

describe("impact by an id a 3.x file states (barwise-wcg.v5k)", () => {
  it("finds an export that recorded the element's 4.0 id", () => {
    const model = new OrmYamlSerializer().deserialize(`orm_version: "3.0"
model:
  name: Shop
  object_types:
    - { id: ot-1, name: Customer, kind: entity, reference_mode: nr }
`);
    expect(model.getObjectType("Customer")).toBeDefined();
    const m: LineageManifest = {
      version: 2,
      sourceModel: "shop.orm.yaml",
      sourceModelHash: "h",
      exports: [exported("a.sql", "Customer", "h")],
    };
    expect(analyzeImpact(m, "ot-1", undefined, model).affectedArtifacts.map((a) => a.artifact))
      .toEqual(["a.sql"]);
    expect(analyzeImpact(m, "ot-1").affectedArtifacts).toEqual([]);
  });

  it("finds by a 4.0 id an export that recorded the 3.x id the file states", () => {
    const model = new OrmYamlSerializer().deserialize(`orm_version: "3.0"
model:
  name: Shop
  object_types:
    - { id: ot-1, name: Customer, kind: entity, reference_mode: nr }
`);
    const m = version1(exported("a.sql", "ot-1", "h"));
    const report = analyzeImpact(m, "Customer", undefined, model);
    expect(report.affectedArtifacts.map((a) => a.artifact)).toEqual(["a.sql"]);
    expect(report.exportsBefore40).toEqual([]);
  });
});

describe("the model hash", () => {
  it("changes with a rename, since the names an artifact came from changed", () => {
    const { model: renamed } = renameInModel(
      shop(),
      { kind: "objectType", name: "Customer" },
      "Client",
    );
    expect(hashModel(renamed)).not.toBe(hashModel(shop()));
  });
});

describe("a rename's lineage", () => {
  const manifest = (): LineageManifest => ({
    version: 2,
    sourceModel: "shop.orm.yaml",
    sourceModelHash: "h",
    exports: [
      exported("a.sql", "Customer", "h"),
      { ...exported("b.sql", "Customer", "h"), sourceModel: "other.orm.yaml" },
    ],
  });

  it("rewrites the sources of the renamed model's exports, never the hash or another model's", () => {
    const next = renameInManifest(manifest(), new Map([["Customer", "Client"]]), "shop.orm.yaml")!;
    expect(next.exports.map((e) => [e.artifact, e.sources[0]!.elementId, e.modelHash])).toEqual([
      ["a.sql", "Client", "h"],
      ["b.sql", "Customer", "h"],
    ]);
    expect(renameInManifest(manifest(), new Map([["Order", "Sale"]]), "shop.orm.yaml"))
      .toBeUndefined();
  });

  it("is one write per manifest in a project, folding every domain beside it", () => {
    const domain = (name: string) => {
      const m = new OrmModel({ name, imports: name === "billing" ? { crm: "crm" } : undefined });
      m.addObjectType({
        id: name === "crm" ? "Customer" : "crm:Customer",
        name: "Customer",
        kind: "entity",
        referenceMode: "nr",
      });
      return m;
    };
    const project = new OrmProject({ name: "P" });
    project.addDomain({ path: "domains/crm.orm.yaml", context: "crm" }).setModel(domain("crm"));
    project.addDomain({ path: "domains/billing.orm.yaml", context: "billing" }).setModel(
      domain("billing"),
    );
    const result = renameInProject(
      project,
      "crm",
      { kind: "objectType", name: "Customer" },
      "Client",
    );
    const renames = projectLineageRenames(result);
    expect(renames.map((r) => [r.dir, r.models.map((m) => m.sourceModel)])).toEqual([
      ["domains", ["crm.orm.yaml", "billing.orm.yaml"]],
    ]);
    const held: LineageManifest = {
      version: 2,
      sourceModel: "crm.orm.yaml",
      sourceModelHash: "h",
      exports: [
        { ...exported("crm.sql", "Customer", "h"), sourceModel: "crm.orm.yaml" },
        { ...exported("billing.sql", "crm:Customer", "h"), sourceModel: "billing.orm.yaml" },
      ],
    };
    const { writes, changes } = lineageRenameWrites(renames, (d) => `/p/${d}`, () => held);
    expect(writes.map((w) => w.path)).toEqual(["/p/domains/.barwise/lineage.yaml"]);
    expect(parseManifest(writes[0]!.text).exports.map((e) => e.sources[0]!.elementId)).toEqual([
      "Client",
      "crm:Client",
    ]);
    expect(changes).toHaveLength(1);
  });

  it("writes nothing where no manifest is, or nothing in it changes", () => {
    const renames = modelLineageRenames("shop.orm.yaml", new Map([["Customer", "Client"]]));
    expect(lineageRenameWrites(renames, (d) => d, () => undefined).writes).toEqual([]);
    expect(lineageRenameWrites(renames, (d) => d, () => ({ ...manifest(), exports: [] })).writes)
      .toEqual([]);
  });
});
