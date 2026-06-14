/**
 * End-to-end integration test that runs all three example transcripts
 * through the complete Barwise pipeline:
 *
 *   Transcript -> LLM extraction (replayed from fixture)
 *              -> OrmModel
 *              -> YAML serialization round-trip
 *              -> Validation
 *              -> Verbalization
 *              -> Diagram SVG generation
 *
 * This proves the full pipeline works headless, without VS Code.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { OrmYamlSerializer, ValidationEngine, Verbalizer } from "@barwise/core";
import { generateDiagram } from "@barwise/diagram";
import { parseExtractionFromJson } from "../src/TranscriptProcessor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, "fixtures");
const outputDir = resolve(__dirname, "..", "..", "..", "examples", "output");

function loadFixture(path: string): string {
  return readFileSync(resolve(fixturesDir, path), "utf-8");
}

interface ExampleSpec {
  name: string;
  fixtureFile: string;
  expectedObjectTypes: number;
  expectedFactTypes: number;
  expectedSubtypeFacts?: number;
}

const examples: ExampleSpec[] = [
  {
    name: "Order Management",
    fixtureFile: "responses/order-management.json",
    expectedObjectTypes: 5,
    expectedFactTypes: 4,
  },
  {
    name: "University Enrollment",
    fixtureFile: "responses/university-enrollment.json",
    expectedObjectTypes: 11,
    expectedFactTypes: 10,
  },
  {
    name: "Clinic Appointments",
    fixtureFile: "responses/clinic-appointments.json",
    expectedObjectTypes: 10,
    expectedFactTypes: 9,
  },
  {
    name: "Employee Hierarchy",
    fixtureFile: "responses/employee-hierarchy.json",
    expectedObjectTypes: 5,
    expectedFactTypes: 3,
    expectedSubtypeFacts: 2,
  },
];

describe("Full pipeline integration", () => {
  for (const example of examples) {
    describe(example.name, () => {
      // Step 1: Parse the LLM extraction fixture into an OrmModel.
      const response = loadFixture(example.fixtureFile);
      const result = parseExtractionFromJson(response, example.name);
      const { model } = result;

      it("extracts the expected number of object types", () => {
        expect(model.objectTypes).toHaveLength(example.expectedObjectTypes);
      });

      it("extracts the expected number of fact types", () => {
        expect(model.factTypes).toHaveLength(example.expectedFactTypes);
      });

      if (example.expectedSubtypeFacts !== undefined) {
        it("extracts the expected number of subtype facts", () => {
          expect(model.subtypeFacts).toHaveLength(example.expectedSubtypeFacts!);
        });
      }

      it("produces provenance for all elements", () => {
        expect(result.objectTypeProvenance.length).toBe(
          example.expectedObjectTypes,
        );
        expect(result.factTypeProvenance.length).toBe(
          example.expectedFactTypes,
        );
      });

      // Step 2: Serialize to YAML and round-trip.
      it("round-trips through YAML serialization", () => {
        const serializer = new OrmYamlSerializer();
        const yaml = serializer.serialize(model);

        expect(yaml).toBeTruthy();
        expect(yaml).toContain("object_types:");
        expect(yaml).toContain("fact_types:");

        // Deserialize and check structural equality.
        const roundTripped = serializer.deserialize(yaml);
        expect(roundTripped.objectTypes).toHaveLength(
          model.objectTypes.length,
        );
        expect(roundTripped.factTypes).toHaveLength(model.factTypes.length);

        // Every object type name should survive the round trip.
        for (const ot of model.objectTypes) {
          expect(roundTripped.getObjectTypeByName(ot.name)).toBeDefined();
        }

        // Every fact type name should survive the round trip.
        for (const ft of model.factTypes) {
          expect(roundTripped.getFactTypeByName(ft.name)).toBeDefined();
        }
      });

      // Step 3: Validate.
      it("passes validation with no errors", () => {
        const engine = new ValidationEngine();
        const diagnostics = engine.validate(model);
        const errors = diagnostics.filter((d) => d.severity === "error");

        // Log any errors for debugging.
        if (errors.length > 0) {
          console.log(
            `Validation errors for ${example.name}:`,
            errors.map((e) => `[${e.ruleId}] ${e.message}`),
          );
        }
        expect(errors).toHaveLength(0);
      });

      // Step 4: Verbalize.
      it("produces verbalizations for all fact types", () => {
        const verbalizer = new Verbalizer();
        const verbalizations = verbalizer.verbalizeModel(model);

        expect(verbalizations.length).toBeGreaterThan(0);

        // Should have at least one verbalization per fact type.
        const factTypeVerbs = verbalizations.filter(
          (v) => v.category === "fact_type",
        );
        expect(factTypeVerbs.length).toBeGreaterThanOrEqual(
          model.factTypes.length,
        );

        // Every verbalization should have non-empty text.
        for (const v of verbalizations) {
          expect(v.text.trim()).toBeTruthy();
        }
      });

      // Step 5: Lay out the diagram.
      it("lays out the diagram", async () => {
        const diagram = await generateDiagram(model);

        // Should have positioned nodes (absorbed reference mode nodes
        // are excluded from the graph, so count may be less than total).
        expect(diagram.layout.nodes.length).toBeGreaterThan(0);
        expect(diagram.layout.nodes.length).toBeLessThanOrEqual(
          model.objectTypes.length + model.factTypes.length,
        );

        // Write output files for manual inspection.
        mkdirSync(outputDir, { recursive: true });
        const slug = example.name.toLowerCase().replace(/\s+/g, "-");

        const serializer = new OrmYamlSerializer();
        writeFileSync(
          resolve(outputDir, `${slug}.orm.yaml`),
          serializer.serialize(model),
        );

        const verbalizer = new Verbalizer();
        const verbalizations = verbalizer.verbalizeModel(model);
        const verbText = verbalizations.map((v) => v.text).join("\n");
        writeFileSync(resolve(outputDir, `${slug}.verbalizations.txt`), verbText);

        const engine = new ValidationEngine();
        const diagnostics = engine.validate(model);
        const diagText = diagnostics.length > 0
          ? diagnostics
            .map((d) => `[${d.severity}] ${d.ruleId}: ${d.message}`)
            .join("\n")
          : "No diagnostics.";
        writeFileSync(
          resolve(outputDir, `${slug}.diagnostics.txt`),
          diagText,
        );
      });
    });
  }
});
