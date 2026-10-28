/**
 * `format_version` on `.orm-project.yaml` and `.map.yaml` (iri-identity WS4,
 * barwise-y1b), and the namespace fields that version makes safe to add.
 *
 * The rule is `schema-versioning.md` decision 1, applied to the two file
 * kinds that had no version: every written file states one, the schema pins
 * it, a newer file is refused as newer rather than for a field this build
 * does not know, and a file from before versioning still loads.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { ContextMapping } from "../../src/model/ContextMapping.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmProject } from "../../src/model/OrmProject.js";
import {
  CURRENT_MAPPING_FORMAT_VERSION,
  MappingDeserializationError,
  MappingSerializer,
} from "../../src/serialization/MappingSerializer.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import {
  CURRENT_PROJECT_FORMAT_VERSION,
  ProjectDeserializationError,
  ProjectSerializer,
} from "../../src/serialization/ProjectSerializer.js";
import { formatVersionProblem, READ_PLAN_ADVICE } from "../../src/serialization/schemaVersion.js";

const schemaConst = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../schemas/${file}`, import.meta.url), "utf8"))
    .properties.format_version.const;

const MAPPING = (version?: string) =>
  `${version === undefined ? "" : `format_version: "${version}"\n`}mapping:
  source_context: crm
  target_context: billing
  pattern: shared_kernel
`;

const PROJECT = (version?: string, extra = "") =>
  `${version === undefined ? "" : `format_version: "${version}"\n`}project:
  name: Acme
${extra}`;

describe("format_version", () => {
  it("is pinned by each schema to the constant its serializer stamps", () => {
    expect(schemaConst("orm-project.schema.json")).toBe(CURRENT_PROJECT_FORMAT_VERSION);
    expect(schemaConst("context-mapping.schema.json")).toBe(CURRENT_MAPPING_FORMAT_VERSION);
  });

  it("is stamped on every project and mapping file written", () => {
    const manifest = parse(new ProjectSerializer().serialize(new OrmProject({ name: "Acme" })));
    expect(manifest.format_version).toBe(CURRENT_PROJECT_FORMAT_VERSION);
    const mapping = parse(
      new MappingSerializer().serialize(
        new ContextMapping({
          path: "m.map.yaml",
          sourceContext: "crm",
          targetContext: "billing",
          pattern: "shared_kernel",
        }),
      ),
    );
    expect(mapping.format_version).toBe(CURRENT_MAPPING_FORMAT_VERSION);
  });

  it("reads a file from before versioning, and one at the current version", () => {
    const projects = new ProjectSerializer();
    expect(projects.deserialize(PROJECT()).name).toBe("Acme");
    expect(projects.deserialize(PROJECT("1.0")).name).toBe("Acme");
    const mappings = new MappingSerializer();
    expect(mappings.deserialize(MAPPING(), "m").sourceContext).toBe("crm");
    expect(mappings.deserialize(MAPPING("1.0"), "m").sourceContext).toBe("crm");
  });

  it("refuses a newer project file as newer, before the schema sees its fields", () => {
    // A 1.1 field this build does not know: the schema would call it an
    // additional property, and the version check must answer first.
    const yaml = PROJECT("1.1", "  future_field: x\n");
    expect(() => new ProjectSerializer().deserialize(yaml)).toThrow(ProjectDeserializationError);
    expect(() => new ProjectSerializer().deserialize(yaml)).toThrow(/newer barwise/);
    expect(() => new ProjectSerializer().deserialize(yaml)).not.toThrow(/additional/);
  });

  it("refuses a newer mapping file as newer, before the schema sees its fields", () => {
    const yaml = `${MAPPING("2.0")}  future_field: x\n`;
    expect(() => new MappingSerializer().deserialize(yaml, "m")).toThrow(
      MappingDeserializationError,
    );
    expect(() => new MappingSerializer().deserialize(yaml, "m")).toThrow(/newer barwise/);
    expect(() => new MappingSerializer().deserialize(yaml, "m")).not.toThrow(/additional/);
  });

  it("refuses a version below the first as unknown, with the advice a model gets", () => {
    expect(formatVersionProblem({ format_version: "0.9" }, "1.0")).toBe(
      `Unsupported format_version "0.9" (this build reads 1.0): ${READ_PLAN_ADVICE.unknown}`,
    );
    expect(formatVersionProblem({ format_version: "1.0" }, "1.0")).toBeUndefined();
    expect(formatVersionProblem({}, "1.0")).toBeUndefined();
  });

  it("gives a model the same advice for the same reason", () => {
    const newerModel = `orm_version: "99.0"\nmodel:\n  name: M\n`;
    expect(() => new OrmYamlSerializer().deserialize(newerModel)).toThrow(READ_PLAN_ADVICE.newer);
    expect(() => new ProjectSerializer().deserialize(PROJECT("99.0"))).toThrow(
      READ_PLAN_ADVICE.newer,
    );
  });
});

describe("iri_base and namespace", () => {
  it("round-trips a project's iri_base", () => {
    const serializer = new ProjectSerializer();
    const yaml = serializer.serialize(
      new OrmProject({ name: "Acme Corp", iriBase: "https://data.acme.com/acme/" }),
    );
    expect(parse(yaml).project.iri_base).toBe("https://data.acme.com/acme/");
    expect(serializer.deserialize(yaml).iriBase).toBe("https://data.acme.com/acme/");
  });

  it("refuses an iri_base that is not an absolute IRI ending in /", () => {
    const serializer = new ProjectSerializer();
    for (const bad of ["data.acme.com/acme/", "https://data.acme.com/acme", "https://a b/"]) {
      expect(() => serializer.deserialize(PROJECT("1.0", `  iri_base: "${bad}"\n`))).toThrow(
        /iri_base|pattern/,
      );
    }
  });

  it("round-trips a model's namespace", () => {
    const serializer = new OrmYamlSerializer();
    for (const ns of ["https://data.acme.com/ordering/", "https://data.acme.com/ordering#"]) {
      const model = new OrmModel({ name: "Ordering", namespace: ns });
      const yaml = serializer.serialize(model);
      expect(parse(yaml).model.namespace).toBe(ns);
      expect(serializer.deserialize(yaml).namespace).toBe(ns);
    }
  });

  it("refuses a namespace that is not an absolute IRI ending in / or #", () => {
    const serializer = new OrmYamlSerializer();
    for (const bad of ["ordering/", "https://data.acme.com/ordering"]) {
      expect(() =>
        serializer.deserialize(`orm_version: "3.0"\nmodel:\n  name: M\n  namespace: "${bad}"\n`)
      ).toThrow(/namespace|pattern/);
    }
  });
});
