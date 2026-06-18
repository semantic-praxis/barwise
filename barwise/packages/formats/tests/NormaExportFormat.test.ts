/**
 * Tests for the NORMA XML export format adapter and the RT-A round-trip.
 *
 * RT-A is the load-bearing correctness guard from the export spec: for each
 * existing NORMA .orm fixture, import it to a model M = mapper(parser(fixture)),
 * then export and re-import it -- M2 = mapper(parser(serializer(writer(M)))) --
 * and assert M equals M2. Since the fixtures hold only representable
 * constructs, the model -> NORMA direction is lossless and the round-trip
 * must produce an equal model.
 *
 * Model equality uses the diff engine (an empty/unchanged diff means equal)
 * plus explicit checks of the structures the conceptual diff does not cover
 * (subtype facts and objectification), so the guard is complete.
 */
import { clearFormats, getExporter, type OrmModel, registerFormat } from "@barwise/core";
import { diffModels } from "@barwise/core/diff";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { NormaExportFormat } from "../src/norma/NormaExportFormat.js";
import { importNormaXml } from "../src/norma/NormaXmlImporter.js";
import { serializeNormaDocument } from "../src/norma/NormaXmlSerializer.js";
import { writeOrmToNorma } from "../src/norma/NormaXmlWriter.js";
import { normaFormat, registerStandardFormats } from "../src/registration.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FIXTURES = [
  "orderManagement.orm",
  "personCountryDemo.orm",
  "universityEnrollment.orm",
  "employeeProject.orm",
];

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, "fixtures", name), "utf-8");
}

/** Export a model to NORMA XML through the two pure stages. */
function exportToXml(model: OrmModel): string {
  return serializeNormaDocument(writeOrmToNorma(model));
}

/** Assert two models are structurally equal under the diff engine. */
function expectModelsEqual(a: OrmModel, b: OrmModel, fixture: string): void {
  const diff = diffModels(a, b);
  const changed = diff.deltas.filter((d) => d.kind !== "unchanged");
  if (changed.length > 0) {
    const detail = changed
      .map((d) =>
        `${d.kind} ${d.elementType} ${("name" in d ? d.name : "term" in d ? d.term : "")}: `
        + d.changeDescriptions.join("; ")
      )
      .join("\n");
    throw new Error(`RT-A diff for ${fixture} (expected none):\n${detail}`);
  }
  expect(diff.hasChanges).toBe(false);

  // The conceptual diff does not compare subtype facts or objectification;
  // check those explicitly so the round-trip guard is complete.
  expectSubtypesEqual(a, b, fixture);
  expectObjectificationEqual(a, b, fixture);
}

function expectSubtypesEqual(a: OrmModel, b: OrmModel, fixture: string): void {
  const key = (m: OrmModel) =>
    m.subtypeFacts
      .map((sf) =>
        `${m.getObjectType(sf.subtypeId)?.name}<:${m.getObjectType(sf.supertypeId)?.name}`
        + `:excl=${sf.isExclusive}:exh=${sf.isExhaustive}:pid=${sf.providesIdentification}`
      )
      .sort();
  expect(key(b), `subtype facts mismatch for ${fixture}`).toEqual(key(a));
}

function expectObjectificationEqual(a: OrmModel, b: OrmModel, fixture: string): void {
  const key = (m: OrmModel) =>
    m.objectifiedFactTypes
      .map((oft) =>
        `${m.getFactType(oft.factTypeId)?.name}=>${m.getObjectType(oft.objectTypeId)?.name}`
      )
      .sort();
  expect(key(b), `objectification mismatch for ${fixture}`).toEqual(key(a));
}

describe("NormaExportFormat", () => {
  describe("interface properties", () => {
    const format = new NormaExportFormat();

    it("has name 'norma'", () => {
      expect(format.name).toBe("norma");
    });

    it("has a description", () => {
      expect(format.description).toBeTruthy();
    });

    it("implements export", () => {
      expect(typeof format.export).toBe("function");
    });
  });

  describe("RT-A: model -> NORMA -> model is lossless", () => {
    for (const fixture of FIXTURES) {
      it(`round-trips ${fixture}`, () => {
        const original = importNormaXml(loadFixture(fixture));
        const xml = exportToXml(original);
        const reimported = importNormaXml(xml);
        expectModelsEqual(original, reimported, fixture);
      });
    }

    it("round-trips through the adapter export() method", () => {
      const format = new NormaExportFormat();
      for (const fixture of FIXTURES) {
        const original = importNormaXml(loadFixture(fixture));
        const result = format.export(original);
        expect(result.text).toContain("<?xml");
        const reimported = importNormaXml(result.text);
        expectModelsEqual(original, reimported, fixture);
      }
    });
  });

  describe("independent object types", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<orm:ORM2 xmlns:orm="http://schemas.neumont.edu/ORM/2006-04/ORMCore">
  <orm:ORMModel id="_model1" Name="TestModel">
    <orm:Objects>
      <orm:EntityType id="_e1" Name="Color" _ReferenceMode="name" IsIndependent="true">
        <orm:PlayedRoles />
      </orm:EntityType>
    </orm:Objects>
  </orm:ORMModel>
</orm:ORM2>`;

    it("imports IsIndependent and round-trips it through export", () => {
      const model = importNormaXml(xml);
      expect(model.getObjectTypeByName("Color")!.independent).toBe(true);

      const exported = exportToXml(model);
      expect(exported).toContain('IsIndependent="true"');

      const reimported = importNormaXml(exported);
      expect(reimported.getObjectTypeByName("Color")!.independent).toBe(true);
    });
  });

  describe("semantic-only output", () => {
    it("emits no ORMDiagram elements for a model with no layout", () => {
      const model = importNormaXml(loadFixture("orderManagement.orm"));
      const xml = exportToXml(model);
      expect(xml).not.toContain("ORMDiagram");
      expect(xml).not.toContain("ormDiagram");
      // Still semantically complete: objects, facts, and constraints present.
      expect(xml).toContain("<orm:ORMModel");
      expect(xml).toContain("<orm:Objects>");
      expect(xml).toContain("<orm:Facts>");
      expect(xml).toContain("<orm:Constraints>");
    });
  });

  describe("format descriptor and registry", () => {
    it("normaFormat now carries an exporter", () => {
      expect(normaFormat.exporter).toBeDefined();
      expect(normaFormat.exporter?.name).toBe("norma");
    });

    describe("registry integration", () => {
      beforeEach(() => {
        clearFormats();
      });

      it("is discoverable via getExporter after registration", () => {
        registerStandardFormats();
        const exporter = getExporter("norma");
        expect(exporter).toBeDefined();
        expect(exporter?.name).toBe("norma");
      });

      it("is registered with the unified registry", () => {
        registerFormat(normaFormat);
        expect(getExporter("norma")).toBeDefined();
      });
    });
  });
});
