/**
 * Kernel -> a NORMA .orm XML file: the shape an existing ORM shop's
 * tooling emits. The trial's NORMA writer is deliberately minimal and
 * independent of barwise's own exporter (a file the exporter wrote is a
 * file the importer was tested on). It emits object types, value types
 * with data types, binary fact types with roles, internal uniqueness
 * and mandatory constraints, and subtype facts.
 */
import { byId, entities, factTypes, objectTypes, valueTypes } from "../model.mjs";

export function generateNorma(doc, skin, { factor = 1, artifactId = "norma" } = {}) {
  const ids = byId(doc);
  const manifest = {
    artifact: artifactId,
    generator: "norma",
    factor,
    objectTypes: [],
    factTypes: [],
  };
  const out = [];
  const guid = (() => {
    let n = 0;
    return () =>
      `_${(++n).toString(16).padStart(8, "0").toUpperCase()}-0000-4000-8000-000000000000`;
  })();
  const otGuid = new Map();
  const roleGuid = new Map();
  const ftGuid = new Map();
  out.push(`<?xml version="1.0" encoding="utf-8"?>`);
  out.push(
    `<ormRoot:ORM2 xmlns:orm="http://schemas.neumont.edu/ORM/2006-04/ORMCore" xmlns:ormRoot="http://schemas.neumont.edu/ORM/2006-04/ORMRoot">`,
  );
  out.push(`  <orm:ORMModel id="${guid()}" Name="${esc(doc.model.name)}">`);
  out.push(`    <orm:Objects>`);
  for (let m = 0; m < factor; m++) {
    const sfx = m === 0 ? "" : `${m + 1}`;
    for (const e of entities(doc)) {
      const g = guid();
      otGuid.set(`${e.id}${sfx}`, g);
      out.push(
        `      <orm:EntityType id="${g}" Name="${esc(e.name + sfx)}" _ReferenceMode="${
          esc(e.reference_mode ?? "")
        }">`,
      );
      out.push(`      </orm:EntityType>`);
      manifest.objectTypes.push(`${e.name}${sfx}`);
    }
    if (m === 0) {
      for (const v of valueTypes(doc)) {
        const g = guid();
        otGuid.set(v.id, g);
        out.push(`      <orm:ValueType id="${g}" Name="${esc(v.name)}">`);
        out.push(
          `        <orm:ConceptualDataType id="${guid()}" ref="${g}-dt" Scale="0" Length="${
            v.data_type?.length ?? 0
          }" />`,
        );
        out.push(`      </orm:ValueType>`);
        manifest.objectTypes.push(v.name);
      }
    }
  }
  out.push(`    </orm:Objects>`);
  out.push(`    <orm:Facts>`);
  const constraints = [];
  for (let m = 0; m < factor; m++) {
    const sfx = m === 0 ? "" : `${m + 1}`;
    for (const ft of factTypes(doc)) {
      const g = guid();
      ftGuid.set(`${ft.id}${sfx}`, g);
      out.push(`      <orm:Fact id="${g}" _Name="${esc(ft.name + (m ? ` ${sfx}` : ""))}">`);
      out.push(`        <orm:FactRoles>`);
      for (const r of ft.roles) {
        const rg = guid();
        roleGuid.set(`${r.id}${sfx}`, rg);
        const player = ids.get(r.player);
        const pg = otGuid.get(player?.kind === "entity" ? `${r.player}${sfx}` : r.player);
        out.push(
          `          <orm:Role id="${rg}" _IsMandatory="false" _Multiplicity="Unspecified" Name="${
            esc(r.role_name ?? "")
          }">`,
        );
        out.push(`            <orm:RolePlayer ref="${pg}" />`);
        out.push(`          </orm:Role>`);
      }
      out.push(`        </orm:FactRoles>`);
      out.push(`        <orm:ReadingOrders>`);
      out.push(`          <orm:ReadingOrder id="${guid()}">`);
      out.push(
        `            <orm:Readings><orm:Reading id="${guid()}"><orm:Data>${
          esc(ft.readings?.[0] ?? "{0} relates to {1}")
        }</orm:Data></orm:Reading></orm:Readings>`,
      );
      out.push(
        `            <orm:RoleSequence>${
          ft.roles.map((r) => `<orm:Role ref="${roleGuid.get(`${r.id}${sfx}`)}" />`).join("")
        }</orm:RoleSequence>`,
      );
      out.push(`          </orm:ReadingOrder>`);
      out.push(`        </orm:ReadingOrders>`);
      out.push(`      </orm:Fact>`);
      manifest.factTypes.push(ft.name + (m ? ` ${sfx}` : ""));
      for (const c of ft.constraints ?? []) {
        if (c.type === "internal_uniqueness") {
          constraints.push(
            `      <orm:UniquenessConstraint id="${guid()}" Name="IUC${constraints.length}" IsInternal="true"${
              c.is_preferred ? ` IsPreferred="true"` : ""
            }><orm:RoleSequence>${
              c.roles.map((rid) => `<orm:Role ref="${roleGuid.get(`${rid}${sfx}`)}" />`).join("")
            }</orm:RoleSequence></orm:UniquenessConstraint>`,
          );
        } else if (c.type === "mandatory") {
          constraints.push(
            `      <orm:MandatoryConstraint id="${guid()}" Name="MC${constraints.length}" IsSimple="true"><orm:RoleSequence><orm:Role ref="${
              roleGuid.get(`${c.role}${sfx}`)
            }" /></orm:RoleSequence></orm:MandatoryConstraint>`,
          );
        }
      }
    }
    for (const sf of doc.model.subtype_facts ?? []) {
      const g = guid();
      const sub = otGuid.get(`${sf.subtype}${sfx}`);
      const sup = otGuid.get(`${sf.supertype}${sfx}`);
      out.push(`      <orm:SubtypeFact id="${g}" _Name="Subtype ${g}" IsPrimary="true">`);
      out.push(`        <orm:FactRoles>`);
      out.push(
        `          <orm:SubtypeMetaRole id="${guid()}"><orm:RolePlayer ref="${sub}" /></orm:SubtypeMetaRole>`,
      );
      out.push(
        `          <orm:SupertypeMetaRole id="${guid()}"><orm:RolePlayer ref="${sup}" /></orm:SupertypeMetaRole>`,
      );
      out.push(`        </orm:FactRoles>`);
      out.push(`      </orm:SubtypeFact>`);
    }
  }
  out.push(`    </orm:Facts>`);
  out.push(`    <orm:Constraints>`);
  out.push(...constraints);
  out.push(`    </orm:Constraints>`);
  out.push(`    <orm:DataTypes>`);
  for (const v of valueTypes(doc)) {
    const kind = {
      integer: "SignedIntegerNumericDataType",
      decimal: "DecimalNumericDataType",
      date: "DateTemporalDataType",
      boolean: "TrueOrFalseLogicalDataType",
    }[v.data_type?.name] ?? "VariableLengthTextDataType";
    out.push(`      <orm:${kind} id="${otGuid.get(v.id)}-dt" />`);
  }
  out.push(`    </orm:DataTypes>`);
  out.push(`  </orm:ORMModel>`);
  out.push(`</ormRoot:ORM2>`);
  return { text: out.join("\n") + "\n", manifest };
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}
