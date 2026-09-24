/**
 * Kernel + skin -> an OpenAPI document whose components.schemas mirror
 * the kernel's entities, with the constructs enterprise APIs actually
 * use and the importer warns about: polymorphism (oneOf / allOf /
 * discriminator), circular $refs, nesting, and paths the importer
 * ignores. The manifest records which schema names an importer should
 * produce and which are deliberately polymorphic.
 */
import { byId, entities, factTypes } from "../model.mjs";

export function generateOpenApi(doc, skin, { factor = 1, artifactId = "openapi" } = {}) {
  const ids = byId(doc);
  const schemas = {};
  const manifest = {
    artifact: artifactId,
    generator: "openapi",
    factor,
    schemas: [],
    polymorphic: [],
    circular: [],
  };
  const subOf = new Map();
  for (const sf of doc.model.subtype_facts ?? []) {
    subOf.set(sf.subtype, sf.supertype);
  }
  const supers = new Map();
  for (const [sub, sup] of subOf) {
    if (!supers.has(sup)) supers.set(sup, []);
    supers.get(sup).push(sub);
  }
  for (let m = 0; m < factor; m++) {
    const sfx = m === 0 ? "" : `${m + 1}`;
    for (const e of entities(doc)) {
      const name = `${e.name}${sfx}`;
      const props = {};
      const required = [];
      for (const ft of factTypes(doc)) {
        const [r0, r1] = ft.roles;
        if (!r1 || r0.player !== e.id) continue;
        const other = ids.get(r1.player);
        if (!other) continue;
        const pname = camel(other.name);
        const single = (ft.constraints ?? []).some((c) =>
          c.type === "internal_uniqueness" && c.roles.length === 1 && c.roles[0] === r0.id
        );
        const mand = (ft.constraints ?? []).some((c) => c.type === "mandatory" && c.role === r0.id);
        if (other.kind === "value") {
          const p = { type: jsonType(other) };
          if (other.value_constraint?.values) p.enum = other.value_constraint.values.slice();
          if (other.data_type?.length) p.maxLength = other.data_type.length;
          props[pname] = single ? p : { type: "array", items: p };
        } else {
          const ref = { $ref: `#/components/schemas/${other.name}${sfx}` };
          props[pname] = single ? ref : { type: "array", items: ref };
        }
        if (mand) required.push(pname);
      }
      if (skin.circular_refs && m === 0) {
        // Every entity points back at the first one; the first points at the last.
        const all = entities(doc);
        const target = e === all[0] ? all[all.length - 1] : all[0];
        props["related"] = { $ref: `#/components/schemas/${target.name}${sfx}` };
        manifest.circular.push([name, `${target.name}${sfx}`]);
      }
      let schema = { type: "object", description: e.definition ?? "", properties: props };
      if (required.length) schema.required = required;
      const children = supers.get(e.id) ?? [];
      const parent = subOf.get(e.id);
      if (children.length && skin.polymorphism === "oneOf") {
        schema = {
          oneOf: children.map((c) => ({ $ref: `#/components/schemas/${ids.get(c).name}${sfx}` })),
          discriminator: { propertyName: skin.discriminator ?? "kind" },
        };
        manifest.polymorphic.push(name);
      } else if (children.length && skin.polymorphism === "discriminator") {
        schema.discriminator = {
          propertyName: skin.discriminator ?? "resourceType",
          mapping: Object.fromEntries(
            children.map((c) => [ids.get(c).name, `#/components/schemas/${ids.get(c).name}${sfx}`]),
          ),
        };
        manifest.polymorphic.push(name);
      }
      if (parent && skin.polymorphism === "allOf") {
        schema = {
          allOf: [{ $ref: `#/components/schemas/${ids.get(parent).name}${sfx}` }, {
            type: "object",
            properties: props,
          }],
        };
        manifest.polymorphic.push(name);
      }
      if (skin.nesting_depth && m === 0) {
        let nested = { type: "object", properties: { leaf: { type: "string" } } };
        for (let d = 1; d < skin.nesting_depth; d++) {
          nested = { type: "object", properties: { [`level${d}`]: nested } };
        }
        props["metadata"] = nested;
      }
      schemas[name] = schema;
      manifest.schemas.push({ name, source: e.name, module: m + 1 });
    }
  }
  const paths = {};
  for (const s of manifest.schemas.slice(0, 40)) {
    paths[`/${camel(s.name)}s`] = {
      get: {
        summary: `List ${s.name}`,
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: `#/components/schemas/${s.name}` } },
              },
            },
          },
        },
      },
      post: {
        summary: `Create ${s.name}`,
        requestBody: {
          content: { "application/json": { schema: { $ref: `#/components/schemas/${s.name}` } } },
        },
        responses: { "201": { description: "created" } },
      },
    };
  }
  const document = {
    openapi: skin.version ?? "3.0.3",
    info: {
      title: doc.model.name,
      version: "4.2.0",
      description: "Generated for the barwise enterprise trial.",
    },
    paths,
    components: { schemas },
  };
  return { text: JSON.stringify(document, null, 2), manifest };
}

function camel(name) {
  return name.charAt(0).toLowerCase() + name.slice(1).replace(/[^A-Za-z0-9]/g, "");
}

function jsonType(vt) {
  const n = vt.data_type?.name ?? "text";
  if (["integer", "int"].includes(n)) return "integer";
  if (["decimal", "number", "float"].includes(n)) return "number";
  if (n === "boolean") return "boolean";
  return "string";
}
