/**
 * Drift guard for the committed showcase artifacts under
 * examples/output/ (barwise-870; drift-guards spec workstream 4).
 *
 * Each .verbalizations.txt and .diagnostics.txt is a pure derivation
 * of its committed .orm.yaml sibling, so this test re-derives both
 * in memory and byte-compares -- the same guard shape as
 * docs/tutorial/ and builtins.generated.ts. Before this test existed,
 * four places cited it and two regenerators disagreed about the file
 * format; now the derivation here is the one writer:
 * `npm run regen:examples` runs this file with UPDATE_GOLDEN=1.
 *
 * The .orm.yaml models themselves are deliberately NOT drift-tested:
 * they are refreshed from the recorded pipeline fixtures
 * (Pipeline.integration.test.ts, also under UPDATE_GOLDEN=1), and
 * every refresh mints fresh element ids.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { ValidationEngine } from "../../src/validation/ValidationEngine.js";
import { Verbalizer } from "../../src/verbalization/Verbalizer.js";

const outputDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../examples/output",
);
const UPDATE = process.env["UPDATE_GOLDEN"] === "1";

function deriveVerbalizations(modelYaml: string): string {
  const model = new OrmYamlSerializer().deserialize(modelYaml);
  return new Verbalizer().verbalizeModel(model).map((v) => v.text).join("\n");
}

function deriveDiagnostics(modelYaml: string): string {
  const model = new OrmYamlSerializer().deserialize(modelYaml);
  const diagnostics = new ValidationEngine().validate(model);
  return diagnostics.length > 0
    ? diagnostics.map((d) => `[${d.severity}] ${d.ruleId}: ${d.message}`).join("\n")
    : "No diagnostics.";
}

describe("examples/output derived artifacts", () => {
  const models = readdirSync(outputDir).filter((f) => f.endsWith(".orm.yaml"));

  it("has at least one committed model to guard", () => {
    expect(models.length).toBeGreaterThan(0);
  });

  for (const modelFile of models) {
    const base = modelFile.replace(/\.orm\.yaml$/, "");

    it(`${base}: committed verbalizations match a fresh derivation`, () => {
      const derived = deriveVerbalizations(
        readFileSync(resolve(outputDir, modelFile), "utf8"),
      );
      const target = resolve(outputDir, `${base}.verbalizations.txt`);
      if (UPDATE) {
        mkdirSync(outputDir, { recursive: true });
        writeFileSync(target, derived);
      }
      expect(readFileSync(target, "utf8")).toBe(derived);
    });

    it(`${base}: committed diagnostics match a fresh derivation`, () => {
      const derived = deriveDiagnostics(
        readFileSync(resolve(outputDir, modelFile), "utf8"),
      );
      const target = resolve(outputDir, `${base}.diagnostics.txt`);
      if (UPDATE) {
        writeFileSync(target, derived);
      }
      expect(readFileSync(target, "utf8")).toBe(derived);
    });
  }
});
