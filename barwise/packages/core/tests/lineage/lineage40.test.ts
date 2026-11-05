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
import { replayInto40 } from "../../src/serialization/replay.js";

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

  it("is no manifest when the file is empty, and a version this build does not know is left", () => {
    expect(parseManifest("")).toBeNull();
    const later = parseManifest(
      "version: 3\nsourceModel: shop.orm.yaml\nsourceModelHash: h\nexports: []\n",
    );
    expect(later.version).toBe(3);
    expect(parseManifest("version: 1\nsourceModel: s\nsourceModelHash: h\n").exports)
      .toEqual([]);
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

  it("is named by impact analysis, not left out, when no model reads its 3.x ids", () => {
    const m = version1(exported("a.sql", "ot-1", "h"));
    const report = analyzeImpact(m, "Customer");
    expect(report.affectedArtifacts).toEqual([]);
    expect(report.exportsBefore40).toEqual(["a.sql"]);
  });

  it("is never matched by a 4.0 id, with a 4.0 model or none: it is listed as unknown", () => {
    // The 3.x id Customer may have named another element (the pr-review on 6e).
    const m = version1(exported("a.sql", "Customer", "h"));
    for (const model of [shop(), undefined]) {
      const report = analyzeImpact(m, "Customer", undefined, model);
      expect(report.affectedArtifacts).toEqual([]);
      expect(report.exportsBefore40).toEqual(["a.sql"]);
    }
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

  it("finds by its 4.0 id an export of an element the model no longer holds", () => {
    // A deleted element: the replayed model holds the id under neither
    // reading, so it is taken as a 4.0 id and still finds the export that
    // recorded it (the pr-review of #925: only an mcp test reached this
    // branch, and by accident).
    const model = new OrmYamlSerializer().deserialize(`orm_version: "3.0"
model:
  name: Shop
  object_types:
    - { id: ot-1, name: Customer, kind: entity, reference_mode: nr }
`);
    expect(model.getObjectType("Retired")).toBeUndefined();
    const m: LineageManifest = {
      version: 2,
      sourceModel: "shop.orm.yaml",
      sourceModelHash: "h",
      exports: [exported("a.sql", "Retired", "h")],
    };
    expect(analyzeImpact(m, "Retired", undefined, model).affectedArtifacts.map((a) => a.artifact))
      .toEqual(["a.sql"]);
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

  it("does not list a marked export that misses the 3.x id it was asked by", () => {
    const model = new OrmYamlSerializer().deserialize(`orm_version: "3.0"
model:
  name: Shop
  object_types:
    - { id: ot-1, name: Customer, kind: entity, reference_mode: nr }
`);
    const report = analyzeImpact(
      version1(exported("a.sql", "ot-9", "h")),
      "ot-1",
      undefined,
      model,
    );
    expect(report.affectedArtifacts).toEqual([]);
    expect(report.exportsBefore40).toEqual([]);
  });

  it("does not list a marked export that misses a 3.x id the model knows", () => {
    const model = new OrmYamlSerializer().deserialize(`orm_version: "3.0"
model:
  name: Shop
  object_types:
    - { id: ot-1, name: Customer, kind: entity, reference_mode: nr }
`);
    const m = version1(exported("a.sql", "ot-9", "h"));
    expect(analyzeImpact(m, "Customer", undefined, model).exportsBefore40).toEqual([]);
    expect(analyzeImpact(m, "Customer").exportsBefore40).toEqual(["a.sql"]);
  });
});

describe("impact across id generations (Copilot, on 6e)", () => {
  // The type named Customer held the 3.x id Order; the type named Order held ot-order.
  const model = () =>
    new OrmYamlSerializer().deserialize(`orm_version: "3.0"
model:
  name: Shop
  object_types:
    - { id: Order, name: Customer, kind: entity, reference_mode: nr }
    - { id: ot-order, name: Order, kind: entity, reference_mode: nr }
`);
  const mixed: LineageManifest = {
    version: 2,
    sourceModel: "shop.orm.yaml",
    sourceModelHash: "h",
    exports: [
      { ...exported("customers-3x.sql", "Order", "h"), idsBefore40: true },
      exported("orders-40.sql", "Order", "h"),
      exported("customers-40.sql", "Customer", "h"),
    ],
  };
  const affected = (id: string) =>
    analyzeImpact(mixed, id, undefined, model()).affectedArtifacts.map((a) => a.artifact);

  it("matches each export by the id of its own generation, never pooled", () => {
    expect(affected("Customer")).toEqual(["customers-3x.sql", "customers-40.sql"]);
  });

  it("reads an id that is both as the one the 3.x file states", () => {
    // Order is Customer's 3.x id and, under 4.0, the Order type's id.
    expect(affected("Order")).toEqual(["customers-3x.sql", "customers-40.sql"]);
  });
});

describe("impact over a 3.x id more than one element stated (Copilot, the pr-review, the owner, on 6e)", () => {
  // 3.x let the object type Person and the fact type Person smokes both state x1.
  const model = () => {
    const source = new OrmModel({ name: "Shared" });
    source.addObjectType({ id: "x1", name: "Person", kind: "entity", referenceMode: "nr" });
    source.addFactType({
      id: "x1",
      name: "Person smokes",
      roles: [{ id: "r1", name: "smokes", playerId: "x1" }],
      readings: ["{0} smokes"],
    });
    return replayInto40(source);
  };
  const asFactType: ManifestExport = {
    ...exported("smokers.sql", "x1", "h"),
    sources: [{ elementId: "x1", elementType: "FactType", elementName: "Person smokes" }],
  };
  const m = version1(
    exported("people.sql", "x1", "h"),
    asFactType,
    exported("other.sql", "zz", "h"),
  );

  it("never matches the shared id, by either element: it lists the exports holding it", () => {
    for (const id of ["Person", "Person_smokes"]) {
      const report = analyzeImpact(m, id, undefined, model());
      expect(report.affectedArtifacts, id).toEqual([]);
      expect(report.exportsBefore40, id).toEqual(["people.sql", "smokers.sql"]);
      expect(report, id).not.toHaveProperty("ambiguous");
    }
  });

  it("names the candidates when asked by the shared id itself, matching nothing", () => {
    // A 4.0 export of either element is not matched either: x1 is no 4.0 id.
    const both: LineageManifest = {
      ...m,
      exports: [...m.exports, exported("people-40.sql", "Person", "h")],
    };
    const report = analyzeImpact(both, "x1", undefined, model());
    expect(report.ambiguous).toEqual(["Person", "Person_smokes"]);
    expect(report.affectedArtifacts).toEqual([]);
    expect(report.exportsBefore40).toEqual(["people.sql", "smokers.sql"]);
  });

  it("lists, whatever kind the other element is, such as a population", () => {
    const source = new OrmModel({ name: "Shared" });
    source.addObjectType({ id: "x1", name: "Person", kind: "entity", referenceMode: "nr" });
    source.addFactType({
      id: "f1",
      name: "Person smokes",
      roles: [{ id: "r1", name: "smokes", playerId: "x1" }],
      readings: ["{0} smokes"],
    });
    source.addPopulation({ id: "x1", factTypeId: "f1", instances: [{ roleValues: { r1: "p1" } }] });
    const shared = version1(exported("people.sql", "x1", "h"), exported("other.sql", "zz", "h"));
    for (const id of ["Person", "Person_smokes.population"]) {
      const report = analyzeImpact(shared, id, undefined, replayInto40(source));
      expect(report.affectedArtifacts, id).toEqual([]);
      expect(report.exportsBefore40, id).toEqual(["people.sql"]);
    }
  });

  it("still matches 4.0 exports, and a third element's own 3.x id, when the shared id is also a 4.0 id", () => {
    // Room states Room, and so does the fact type; Room's 4.0 id is Room.
    const room = new OrmModel({ name: "Shared" });
    room.addObjectType({ id: "Room", name: "Room", kind: "entity", referenceMode: "nr" });
    room.addFactType({
      id: "Room",
      name: "Room is booked",
      roles: [{ id: "r1", name: "is booked", playerId: "Room" }],
      readings: ["{0} is booked"],
    });
    const rooms: LineageManifest = {
      version: 2,
      sourceModel: "shop.orm.yaml",
      sourceModelHash: "h",
      exports: [
        exported("rooms-40.sql", "Room", "h"),
        { ...exported("rooms-3x.sql", "Room", "h"), idsBefore40: true },
        { ...exported("other-3x.sql", "zz", "h"), idsBefore40: true },
      ],
    };
    const report = analyzeImpact(rooms, "Room", undefined, replayInto40(room));
    expect(report.ambiguous).toEqual(["Room", "Room_is_booked"]);
    expect(report.affectedArtifacts.map((a) => a.artifact)).toEqual(["rooms-40.sql"]);
    expect(report.exportsBefore40).toEqual(["rooms-3x.sql"]);

    // Client and its fact type state Customer; the type named Customer states c9.
    const third = new OrmModel({ name: "Shared" });
    third.addObjectType({ id: "Customer", name: "Client", kind: "entity", referenceMode: "nr" });
    third.addObjectType({ id: "c9", name: "Customer", kind: "entity", referenceMode: "nr" });
    third.addFactType({
      id: "Customer",
      name: "Client buys",
      roles: [{ id: "r1", name: "buys", playerId: "Customer" }],
      readings: ["{0} buys"],
    });
    const customers: LineageManifest = {
      ...rooms,
      exports: [
        exported("customers-40.sql", "Customer", "h"),
        { ...exported("customers-c9.sql", "c9", "h"), idsBefore40: true },
        { ...exported("clients-3x.sql", "Customer", "h"), idsBefore40: true },
      ],
    };
    const thirdReport = analyzeImpact(customers, "Customer", undefined, replayInto40(third));
    expect(thirdReport.ambiguous).toEqual(["Client", "Client_buys"]);
    // The pr-review on e15c18d1: the Customer type's own 3.x export matches by c9.
    expect(thirdReport.affectedArtifacts.map((a) => a.artifact)).toEqual([
      "customers-40.sql",
      "customers-c9.sql",
    ]);
    expect(thirdReport.exportsBefore40).toEqual(["clients-3x.sql"]);
  });

  it("states no ambiguity, and lists nothing, for an element whose 3.x id is its own", () => {
    const withRole = version1(...m.exports, exported("smokes.sql", "r1", "h"));
    const report = analyzeImpact(withRole, "Person_smokes.smokes", undefined, model());
    expect(report).not.toHaveProperty("ambiguous");
    expect(report.affectedArtifacts.map((a) => a.artifact)).toEqual(["smokes.sql"]);
    expect(report.exportsBefore40).toEqual([]);
  });

  it("lists every marked export it misses for an id the model holds under neither reading", () => {
    // A deleted element, say: no 3.x id is known for it (the pr-review on a5d9fcb0).
    const gone = version1(exported("gone.sql", "g9", "h"), exported("other.sql", "zz", "h"));
    const report = analyzeImpact(gone, "g9", undefined, model());
    expect(report.affectedArtifacts).toEqual([]);
    expect(report.exportsBefore40).toEqual(["gone.sql", "other.sql"]);
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

  it("leaves an export written under 3.x ids, whose ids a 4.0 map can collide with", () => {
    const marked: LineageManifest = {
      ...manifest(),
      exports: [{ ...exported("a.sql", "Customer", "h"), idsBefore40: true }],
    };
    expect(renameInManifest(marked, new Map([["Customer", "Client"]]), "shop.orm.yaml"))
      .toBeUndefined();
  });

  it("takes an empty manifest file, which parses to null, as none", () => {
    const renames = modelLineageRenames(
      { dir: "/p", sourceModel: "shop.orm.yaml" },
      new Map([["Customer", "Client"]]),
    );
    expect(lineageRenameWrites(renames, () => parseManifest("")).writes).toEqual([]);
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
    // Two spellings of one directory, as a project may name its domains:
    // the locator resolves both to one place, so they are one write.
    const locate = (p: string) => ({
      dir: `/p/${p.replace(/^\.\//, "").replace(/\/[^/]*$/, "")}`,
      sourceModel: p.replace(/^.*\//, ""),
    });
    const spelled = (p: string) => (p.startsWith("domains/billing") ? `./${p}` : p);
    const renames = projectLineageRenames(result, (p) => locate(spelled(p)));
    expect(renames.map((r) => [r.dir, r.models.map((m) => m.sourceModel)])).toEqual([
      ["/p/domains", ["crm.orm.yaml", "billing.orm.yaml"]],
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
    const { writes, changes } = lineageRenameWrites(renames, () => held);
    expect(writes.map((w) => w.path)).toEqual(["/p/domains/.barwise/lineage.yaml"]);
    expect(parseManifest(writes[0]!.text).exports.map((e) => e.sources[0]!.elementId)).toEqual([
      "Client",
      "crm:Client",
    ]);
    expect(changes).toHaveLength(1);
  });

  it("writes nothing where no manifest is, or nothing in it changes", () => {
    const renames = modelLineageRenames(
      { dir: "/p", sourceModel: "shop.orm.yaml" },
      new Map([["Customer", "Client"]]),
    );
    expect(lineageRenameWrites(renames, () => undefined).writes).toEqual([]);
    expect(lineageRenameWrites(renames, () => ({ ...manifest(), exports: [] })).writes)
      .toEqual([]);
  });
});
