/**
 * Constraints across fact types in the standard formats (orm-format-3,
 * Open decision 9, WS3b). The fact type a 2.0 file nests such a
 * constraint under decides nothing a format writes: not the DDL spill
 * table, not where NORMA's document lists it, and not whether NORMA's
 * importer keeps a second copy of it.
 */
import { type Constraint, type OrmModel, setIdGenerator } from "@barwise/core";
import { RelationalMapper } from "@barwise/core/mapping";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { routeConstraints } from "../src/ddl/constraintRouting.js";
import { resolveDialectProfile } from "../src/ddl/dialectCapabilities.js";
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
 * each fact type, nested under `host`. The two fact types' nearest tables
 * differ (person for the first, project for the second), which is what
 * used to make the nesting visible in the DDL.
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
  const exclusion: Constraint = {
    id: "c-lead-or-sponsor",
    type: "exclusion",
    roleIds: [roleOf(leads, "leads"), roleOf(sponsors, "sponsors")],
  };
  model.getFactTypeByName(host)!.addConstraint(exclusion);
  return model;
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
    const spill = routed.spilled.find((s) => s.spec.verbalization.includes("leads"));
    expect(spill?.tableName).toBe("person");
    expect(spill?.reason).toBe("not expressible in SQL DDL");
  });
});

describe("constraints across fact types in NORMA", () => {
  const exportXml = (model: OrmModel) => serializeNormaDocument(writeOrmToNorma(model));

  it("writes the same document whichever fact type nests it", () => {
    // For an exclusion alone the old writer gave this document too: the
    // serializer groups constraints by element type and no exclusion is
    // internal. What it guards is the one walk that now writes them.
    const xml = exportXml(projects(leads));
    expect(exportXml(projects(sponsors))).toBe(xml);
    expect(xml.match(/id="_c-lead-or-sponsor"/g)).toHaveLength(1);
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
