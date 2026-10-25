/**
 * Constraints across fact types in the standard formats (orm-format-3,
 * Open decision 9, WS3b). The fact type a 2.0 file nests such a
 * constraint under decides nothing a format writes: not the DDL spill
 * table, not where NORMA's document lists it, and not whether NORMA's
 * importer keeps a second copy of it.
 */
import {
  type ExternalConstraint,
  type OrmModel,
  OrmYamlSerializer,
  setIdGenerator,
} from "@barwise/core";
import { RelationalMapper, resolveDialectProfile, routeConstraints } from "@barwise/core/mapping";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { asNormaId } from "../src/norma/normaId.js";
import { mapNormaToOrm } from "../src/norma/NormaToOrmMapper.js";
import { parseNormaXml } from "../src/norma/NormaXmlParser.js";
import { serializeNormaDocument } from "../src/norma/NormaXmlSerializer.js";
import type { NormaUniquenessConstraint } from "../src/norma/NormaXmlTypes.js";
import { writeOrmToNorma } from "../src/norma/NormaXmlWriter.js";
import { ModelBuilder } from "./helpers/ModelBuilder.js";

const here = dirname(fileURLToPath(import.meta.url));

const leads = "Person leads Project";
const sponsors = "Project is sponsored by Person";
type Host = typeof leads | typeof sponsors;

/**
 * No Person both leads and sponsors a Project: an exclusion over a role of
 * each fact type, and an external uniqueness over the projects one person
 * leads and sponsors, both nested under `host`. The two fact types'
 * nearest tables differ (person for the first, project for the second),
 * which is what used to make the nesting visible in the DDL; each fact
 * type's own uniqueness is what made it visible in NORMA, whose
 * uniqueness group holds both placements.
 */
function projects(host: Host): OrmModel {
  // Element ids from a counter, so two builds differ only where `host` does.
  let n = 0;
  setIdGenerator(() => `id-${++n}`);
  try {
    return build(host);
  } finally {
    setIdGenerator(undefined);
  }
}

function build(host: Host): OrmModel {
  const model = new ModelBuilder("Projects")
    .withEntityType("Person", { referenceMode: "person_id" })
    .withEntityType("Project", { referenceMode: "project_id" })
    .withBinaryFactType(leads, {
      role1: { player: "Person", name: "leads" },
      role2: { player: "Project", name: "is led by" },
      uniqueness: "role2",
    })
    .withBinaryFactType(sponsors, {
      role1: { player: "Project", name: "is sponsored by" },
      role2: { player: "Person", name: "sponsors" },
      uniqueness: "role1",
    })
    .build();
  const roleOf = (factName: string, name: string) =>
    model.getFactTypeByName(factName)!.roles.find((r) => r.name === name)!.id;
  const exclusion: ExternalConstraint = {
    id: "c-lead-or-sponsor",
    type: "exclusion",
    roleIds: [roleOf(leads, "leads"), roleOf(sponsors, "sponsors")],
  };
  const key: ExternalConstraint = {
    id: "c-led-and-sponsored",
    type: "external_uniqueness",
    roleIds: [roleOf(leads, "is led by"), roleOf(sponsors, "is sponsored by")],
  };
  model.addConstraint(exclusion);
  model.addConstraint(key);
  return nestedUnder(model, host, [exclusion.id!, key.id!]);
}

/**
 * `model` read back from a 2.0 file that nests the constraints `ids`
 * under `host`, after its own: in memory such a constraint belongs to the
 * model (WS3c), so the nesting is only a 2.0 file's to vary. A save writes
 * 3.0, which lists them in the model and names each preferred identifier on
 * its entity; the 2.0 form nests the one and flags the other.
 */
function nestedUnder(model: OrmModel, host: Host, ids: readonly string[]): OrmModel {
  const yaml = new OrmYamlSerializer();
  type Raw = { id: string; is_preferred?: boolean; };
  type NestedFactType = { name: string; constraints?: Raw[]; };
  const doc = parse(yaml.serialize(model)) as {
    orm_version: string;
    model: {
      fact_types: NestedFactType[];
      constraints?: Raw[];
      object_types?: { preferred_identifier?: string; }[];
    };
  };
  doc.orm_version = "2.0";
  const fts = doc.model.fact_types;
  const modelLevel = doc.model.constraints ?? [];
  delete doc.model.constraints;
  const moved = ids.map((id) => modelLevel.find((c) => c.id === id)!);
  const target = fts.find((ft) => ft.name === host)!;
  target.constraints = [...(target.constraints ?? []), ...moved];
  const byId = new Map(fts.flatMap((ft) => ft.constraints ?? []).map((c) => [c.id, c]));
  for (const ot of doc.model.object_types ?? []) {
    const ref = ot.preferred_identifier;
    delete ot.preferred_identifier;
    const c = ref === undefined ? undefined : byId.get(ref);
    if (c) c.is_preferred = true;
  }
  return yaml.deserialize(stringify(doc));
}

describe("constraints across fact types in DDL routing", () => {
  const route = (model: OrmModel) =>
    routeConstraints(
      model,
      new RelationalMapper().map(model),
      resolveDialectProfile("postgres"),
      "postgres",
    );

  it("spills to the first spanned fact type's table, whichever fact type nests it", () => {
    const routed = route(projects(leads));
    expect(route(projects(sponsors))).toEqual(routed);
    const exclusion = routed.spilled.find((s) =>
      s.spec.pseudocode.startsWith("no instance plays more than one of")
    );
    expect(exclusion?.tableName).toBe("person");
    expect(exclusion?.reason).toBe("not expressible in SQL DDL");
    expect(routed.clauses).toContainEqual(
      expect.objectContaining({ tableName: "project", sql: "UNIQUE (person_id, fk_person_id)" }),
    );
  });

  it("notes a key missing a column beside the columns it has, and one with none nearest", () => {
    const model = projects(leads);
    const real = model.getFactTypeByName(leads)!.roles.find((r) => r.name === "is led by")!.id;
    model.addConstraint({ id: "c-half", type: "external_uniqueness", roleIds: ["r-ghost", real] });
    model.addConstraint({
      id: "c-none",
      type: "external_uniqueness",
      roleIds: ["r-ghost", "r-gone"],
    });
    const spills = route(model).spilled.map((s) => [s.reason, s.tableName]);
    // Its one real role's column is project.person_id.
    expect(spills).toContainEqual(["a role maps to no column", "project"]);
    // No role resolves, so no fact type names it and no table is nearest.
    expect(spills).toContainEqual(["the roles map to no column", undefined]);
  });
});

describe("constraints across fact types in NORMA", () => {
  const exportXml = (model: OrmModel) => serializeNormaDocument(writeOrmToNorma(model));

  it("writes the same document whichever fact type nests it", () => {
    // The old writer put the external uniqueness after its host's own, so
    // the uniqueness group's order followed the host.
    const xml = exportXml(projects(leads));
    expect(exportXml(projects(sponsors))).toBe(xml);
    expect(xml.match(/id="_c-lead-or-sponsor"/g)).toHaveLength(1);
    expect(xml.match(/id="_c-led-and-sponsored"/g)).toHaveLength(1);
  });

  it("imports one copy of a rule two hosts would each have kept", () => {
    // One external uniqueness listed in the second fact type's
    // InternalConstraints, which phase 1 attaches there, and a top-level
    // copy that phase 3 attaches to the first fact type holding its roles.
    const doc = parseNormaXml(
      readFileSync(resolve(here, "fixtures", "employeeProject.orm"), "utf-8"),
    );
    const [a, b] = doc.factTypes;
    const spanning = (id: string): NormaUniquenessConstraint => ({
      type: "uniqueness",
      id: asNormaId(id),
      name: "",
      isInternal: false,
      isPreferred: false,
      roleRefs: [a!.roles[0]!.id, b!.roles[0]!.id],
    });
    const listed = spanning("_uc_listed");
    const copy = spanning("_uc_copy");
    const model = mapNormaToOrm({
      ...doc,
      constraints: [...doc.constraints, listed, copy],
      factTypes: [
        a!,
        { ...b!, internalConstraintRefs: [...b!.internalConstraintRefs, listed.id] },
        ...doc.factTypes.slice(2),
      ],
    });
    const ids = model.constraints.map((c) => c.id);
    expect(ids.filter((id) => id === "_uc_listed" || id === "_uc_copy")).toEqual(["_uc_listed"]);
  });
});
