/**
 * The formats barwise does not read: an OWL/RDF ontology (a CIM profile
 * shape) and an Avro schema set. The trial generates them anyway,
 * because the step under test is the refusal: does the product say
 * "no importer for owl" in one line, or hand back a stack trace, or --
 * the S1 case -- a model with nothing in it and exit 0.
 */
import { byId, entities, factTypes, valueTypes } from "../model.mjs";

export function generateOwl(doc, skin, { factor = 1, artifactId = "owl" } = {}) {
  const ids = byId(doc);
  const lines = [
    `<?xml version="1.0"?>`,
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#" xmlns:owl="http://www.w3.org/2002/07/owl#" xmlns:cim="http://iec.ch/TC57/CIM100#">`,
    `  <owl:Ontology rdf:about="http://iec.ch/TC57/CIM100"/>`,
  ];
  const manifest = { artifact: artifactId, generator: "owl", factor, classes: [] };
  const targetBytes = (skin.size_mb ?? 0) * 1024 * 1024;
  let m = 0;
  while (true) {
    const sfx = m === 0 ? "" : `${m + 1}`;
    for (const e of entities(doc)) {
      lines.push(
        `  <owl:Class rdf:about="#${e.name}${sfx}"><rdfs:label>${e.name}${sfx}</rdfs:label><rdfs:comment>${
          esc(e.definition ?? "")
        }</rdfs:comment></owl:Class>`,
      );
      manifest.classes.push(`${e.name}${sfx}`);
    }
    for (const sf of doc.model.subtype_facts ?? []) {
      lines.push(
        `  <owl:Class rdf:about="#${
          ids.get(sf.subtype).name
        }${sfx}"><rdfs:subClassOf rdf:resource="#${
          ids.get(sf.supertype).name
        }${sfx}"/></owl:Class>`,
      );
    }
    for (const ft of factTypes(doc)) {
      const [r0, r1] = ft.roles;
      if (!r1) continue;
      const a = ids.get(r0.player);
      const b = ids.get(r1.player);
      const kind = b.kind === "value" ? "DatatypeProperty" : "ObjectProperty";
      lines.push(
        `  <owl:${kind} rdf:about="#${
          camel(ft.name)
        }${sfx}"><rdfs:domain rdf:resource="#${a.name}${sfx}"/><rdfs:range rdf:resource="#${b.name}${sfx}"/></owl:${kind}>`,
      );
    }
    m++;
    const size = lines.reduce((n, l) => n + l.length + 1, 0);
    if (m >= factor && size >= targetBytes) break;
    if (m > 5000) break;
  }
  lines.push(`</rdf:RDF>`);
  return { text: lines.join("\n") + "\n", manifest };
}

export function generateAvro(doc, skin, { artifactId = "avro" } = {}) {
  const ids = byId(doc);
  const schemas = [];
  const manifest = { artifact: artifactId, generator: "avro", records: [] };
  for (const e of entities(doc)) {
    const fields = [];
    for (const ft of factTypes(doc)) {
      const [r0, r1] = ft.roles;
      if (!r1 || r0.player !== e.id) continue;
      const other = ids.get(r1.player);
      if (!other) continue;
      const mand = (ft.constraints ?? []).some((c) => c.type === "mandatory" && c.role === r0.id);
      let type;
      if (other.kind === "value") {
        type = other.data_type?.name === "integer"
          ? "long"
          : other.data_type?.name === "decimal"
          ? { type: "bytes", logicalType: "decimal", precision: 18, scale: 2 }
          : other.data_type?.name === "date"
          ? { type: "int", logicalType: "date" }
          : "string";
        if (other.value_constraint?.values && skin.enums !== false) {
          type = {
            type: "enum",
            name: `${other.name}Enum`,
            symbols: other.value_constraint.values.slice(0, 50).map((v) =>
              String(v).replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1")
            ),
          };
        }
      } else {
        type = skin.nested_records
          ? { type: "record", name: `${other.name}Ref`, fields: [{ name: "id", type: "string" }] }
          : "string";
      }
      fields.push({
        name: camel(other.name),
        type: mand || !skin.unions ? type : ["null", type],
        ...(mand || !skin.unions ? {} : { default: null }),
      });
    }
    schemas.push({
      type: "record",
      name: e.name,
      namespace: "com.trial.events",
      doc: e.definition ?? "",
      fields,
    });
    manifest.records.push(e.name);
  }
  return { text: JSON.stringify(schemas, null, 2), manifest };
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
function camel(name) {
  return name.charAt(0).toLowerCase() + name.slice(1).replace(/[^A-Za-z0-9]/g, "");
}
