/**
 * Tests for the lineage command group.
 */
import { hashModel, type LineageManifest, serializeManifest } from "@barwise/core/lineage";
import * as fs from "node:fs";
import * as os from "node:os";
import { dirname, resolve } from "node:path";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadModel } from "../../src/workspace/io.js";
import { writeManifest } from "../../src/workspace/lineageIo.js";
import { runCli } from "../workspace/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");

/**
 * `simple.orm.yaml`'s constraints carry no explicit `id`, so each load
 * assigns them a fresh random one and `hashModel` -- which hashes the
 * re-serialized YAML -- differs across independent loads of the same
 * file. Every constraint here is pinned, so hashing the same file
 * twice (once to build a manifest, once from the command under test)
 * agrees, which is what an "all fresh" or "mixed" status needs.
 */
const DETERMINISTIC_MODEL = `orm_version: "1.0"

model:
  name: "Deterministic Test"
  domain_context: "testing"

  object_types:
    - id: "ot-customer"
      name: "Customer"
      kind: "entity"
      reference_mode: "customer_id"

    - id: "ot-name"
      name: "Name"
      kind: "value"

  fact_types:
    - id: "ft-customer-has-name"
      name: "Customer has Name"
      roles:
        - id: "r-customer-has"
          player: "ot-customer"
          role_name: "has"
        - id: "r-name-of"
          player: "ot-name"
          role_name: "is of"
      readings:
        - "{0} has {1}"
        - "{1} is of {0}"
      constraints:
        - id: "c-uniq"
          type: "internal_uniqueness"
          roles: ["r-customer-has"]
        - id: "c-mand"
          type: "mandatory"
          role: "r-customer-has"
`;

describe("barwise lineage", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "barwise-cli-lineage-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("status", () => {
    it("reports no manifest when none exists", async () => {
      // Copy simple.orm.yaml to temp dir
      const modelPath = path.join(tempDir, "test.orm.yaml");
      fs.copyFileSync(`${fixtures}/simple.orm.yaml`, modelPath);

      const result = await runCli(["lineage", "status", modelPath]);

      expect(result.stdout).toContain("No lineage manifest found");
      expect(result.exitCode).toBe(0);
    });

    it("reports all artifacts fresh when every export's hash matches", async () => {
      const modelPath = path.join(tempDir, "test.orm.yaml");
      fs.writeFileSync(modelPath, DETERMINISTIC_MODEL);

      const model = loadModel(modelPath);
      const modelHash = hashModel(model);

      const manifest: LineageManifest = {
        version: 2,
        sourceModel: "test.orm.yaml",
        sourceModelHash: modelHash,
        exports: [
          {
            artifact: "schema.sql",
            format: "ddl",
            exportedAt: "2026-03-06T12:00:00Z",
            modelHash,
            sources: [],
            sourceModel: "test.orm.yaml",
          },
        ],
      };
      writeManifest(tempDir, manifest);

      const result = await runCli(["lineage", "status", modelPath]);

      expect(result.stdout).toContain("All artifacts are fresh.");
      expect(result.stdout).toContain("1 artifact(s) up to date.");
      expect(result.exitCode).toBe(0);
    });

    it("reports stale artifacts when model changed and exits 1", async () => {
      // Copy simple.orm.yaml to temp dir
      const modelPath = path.join(tempDir, "test.orm.yaml");
      fs.copyFileSync(`${fixtures}/simple.orm.yaml`, modelPath);

      const _model = loadModel(modelPath);

      // Create manifest with a different hash (simulating old model)
      const oldHash = "a1b2c3d4e5f6000000000000000000000000000000000000000000000000";
      const manifest: LineageManifest = {
        version: 2,
        sourceModel: "test.orm.yaml",
        sourceModelHash: oldHash,
        exports: [
          {
            artifact: "schema.sql",
            format: "ddl",
            exportedAt: "2026-03-06T12:00:00Z",
            modelHash: oldHash,
            sources: [],
            sourceModel: "test.orm.yaml",
          },
          {
            artifact: "models/game.sql",
            format: "dbt",
            exportedAt: "2026-03-06T12:00:00Z",
            modelHash: oldHash,
            sources: [],
            sourceModel: "test.orm.yaml",
          },
        ],
      };

      writeManifest(tempDir, manifest);

      const result = await runCli(["lineage", "status", modelPath]);

      expect(result.stdout).toContain("2 stale artifact(s) found");
      expect(result.stdout).toContain("schema.sql");
      expect(result.stdout).toContain("models/game.sql");
      expect(result.stdout).toContain("model hash changed");
      expect(result.exitCode).toBe(1);
    });

    it("outputs JSON with --format json", async () => {
      const modelPath = path.join(tempDir, "test.orm.yaml");
      fs.copyFileSync(`${fixtures}/simple.orm.yaml`, modelPath);

      const model = loadModel(modelPath);
      const modelHash = hashModel(model);

      const manifest: LineageManifest = {
        version: 2,
        sourceModel: "test.orm.yaml",
        sourceModelHash: modelHash,
        exports: [
          {
            artifact: "schema.sql",
            format: "ddl",
            exportedAt: "2026-03-06T12:00:00Z",
            modelHash,
            sources: [],
            sourceModel: "test.orm.yaml",
          },
        ],
      };

      writeManifest(tempDir, manifest);

      const result = await runCli([
        "lineage",
        "status",
        modelPath,
        "--format",
        "json",
      ]);

      const parsed = JSON.parse(result.stdout);
      expect(parsed).toHaveProperty("manifestFound", true);
      expect(parsed).toHaveProperty("staleArtifacts");
      expect(parsed).toHaveProperty("freshArtifacts");
      expect(Array.isArray(parsed.staleArtifacts)).toBe(true);
      expect(Array.isArray(parsed.freshArtifacts)).toBe(true);
    });

    it("reports a fresh-artifact count alongside stale ones", async () => {
      const modelPath = path.join(tempDir, "test.orm.yaml");
      fs.writeFileSync(modelPath, DETERMINISTIC_MODEL);

      const model = loadModel(modelPath);
      const modelHash = hashModel(model);
      const oldHash = "a1b2c3d4e5f6000000000000000000000000000000000000000000000000";

      const manifest: LineageManifest = {
        version: 2,
        sourceModel: "test.orm.yaml",
        sourceModelHash: modelHash,
        exports: [
          {
            artifact: "stale.sql",
            format: "ddl",
            exportedAt: "2026-03-06T12:00:00Z",
            modelHash: oldHash,
            sources: [],
            sourceModel: "test.orm.yaml",
          },
          {
            artifact: "fresh.sql",
            format: "ddl",
            exportedAt: "2026-03-06T12:00:00Z",
            modelHash,
            sources: [],
            sourceModel: "test.orm.yaml",
          },
        ],
      };
      writeManifest(tempDir, manifest);

      const result = await runCli(["lineage", "status", modelPath]);

      expect(result.stdout).toContain("1 stale artifact(s) found");
      expect(result.stdout).toContain("1 artifact(s) still fresh.");
      expect(result.exitCode).toBe(1);
    });

    it("fails on an artifact it cannot place, though nothing is stale", async () => {
      // An export written before exports named their model, with no sources
      // to attribute it by (iri-identity 6a), in a directory with a second
      // model, so neither can say whose it is: neither fresh nor stale.
      const modelPath = path.join(tempDir, "test.orm.yaml");
      fs.writeFileSync(modelPath, DETERMINISTIC_MODEL);
      fs.copyFileSync(`${fixtures}/simple.orm.yaml`, path.join(tempDir, "other.orm.yaml"));
      const modelHash = hashModel(loadModel(modelPath));
      writeManifest(tempDir, {
        version: 2,
        sourceModel: "test.orm.yaml",
        sourceModelHash: modelHash,
        exports: [
          {
            artifact: "schema.sql",
            format: "ddl",
            exportedAt: "2026-03-06T12:00:00Z",
            modelHash,
            sources: [],
          },
        ],
      });

      const result = await runCli(["lineage", "status", modelPath]);

      expect(result.stdout).toContain("1 artifact(s) name no model");
      expect(result.stdout).toContain("No artifacts are recorded for this model.");
      expect(result.exitCode).toBe(1);
    });

    it("counts such an artifact as the model's when it is alone in its directory", async () => {
      const modelPath = path.join(tempDir, "test.orm.yaml");
      fs.writeFileSync(modelPath, DETERMINISTIC_MODEL);
      const modelHash = hashModel(loadModel(modelPath));
      writeManifest(tempDir, {
        version: 2,
        sourceModel: "test.orm.yaml",
        sourceModelHash: modelHash,
        exports: [{
          artifact: "schema.sql",
          format: "ddl",
          exportedAt: "2026-03-06T12:00:00Z",
          modelHash,
          sources: [],
        }],
      });

      const result = await runCli(["lineage", "status", modelPath]);

      expect(result.stdout).toContain("All artifacts are fresh.");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("impact", () => {
    it("reports no affected artifacts when element not in manifest", async () => {
      const modelPath = path.join(tempDir, "test.orm.yaml");
      fs.copyFileSync(`${fixtures}/simple.orm.yaml`, modelPath);

      const model = loadModel(modelPath);
      const modelHash = hashModel(model);

      const manifest: LineageManifest = {
        version: 2,
        sourceModel: "test.orm.yaml",
        sourceModelHash: modelHash,
        exports: [
          {
            artifact: "schema.sql",
            format: "ddl",
            exportedAt: "2026-03-06T12:00:00Z",
            modelHash,
            sources: [],
            sourceModel: "test.orm.yaml",
          },
        ],
      };

      writeManifest(tempDir, manifest);

      const result = await runCli([
        "lineage",
        "impact",
        modelPath,
        "--element",
        "Customer",
      ]);

      expect(result.stdout).toContain("Impact analysis for element");
      expect(result.stdout).toContain("No artifacts depend on this element");
      expect(result.exitCode).toBe(0);
    });

    it("reports affected artifacts when element referenced", async () => {
      const modelPath = path.join(tempDir, "test.orm.yaml");
      fs.copyFileSync(`${fixtures}/simple.orm.yaml`, modelPath);

      const model = loadModel(modelPath);
      const modelHash = hashModel(model);

      const elementId = "Customer";

      const manifest: LineageManifest = {
        version: 2,
        sourceModel: "test.orm.yaml",
        sourceModelHash: modelHash,
        exports: [
          {
            artifact: "schema.sql",
            format: "ddl",
            exportedAt: "2026-03-06T12:00:00Z",
            modelHash,
            sources: [
              {
                elementId,
                elementType: "EntityType",
                elementName: "Game",
              },
            ],
          },
          {
            artifact: "models/game.sql",
            format: "dbt",
            exportedAt: "2026-03-06T12:00:00Z",
            modelHash,
            sources: [
              {
                elementId,
                elementType: "EntityType",
                elementName: "Game",
              },
            ],
          },
        ],
      };

      writeManifest(tempDir, manifest);

      const result = await runCli([
        "lineage",
        "impact",
        modelPath,
        "--element",
        elementId,
      ]);

      expect(result.stdout).toContain("Impact analysis for element");
      expect(result.stdout).toContain("2 artifact(s) affected");
      expect(result.stdout).toContain("schema.sql");
      expect(result.stdout).toContain("models/game.sql");
      expect(result.stdout).toContain("derived from entity type Game");
      expect(result.exitCode).toBe(0);
    });

    it("outputs JSON with --format json", async () => {
      const modelPath = path.join(tempDir, "test.orm.yaml");
      fs.copyFileSync(`${fixtures}/simple.orm.yaml`, modelPath);

      const model = loadModel(modelPath);
      const modelHash = hashModel(model);

      const manifest: LineageManifest = {
        version: 2,
        sourceModel: "test.orm.yaml",
        sourceModelHash: modelHash,
        exports: [],
      };

      writeManifest(tempDir, manifest);

      const result = await runCli([
        "lineage",
        "impact",
        modelPath,
        "--element",
        "Customer",
        "--format",
        "json",
      ]);

      const parsed = JSON.parse(result.stdout);
      expect(parsed).toHaveProperty("changedElement");
      expect(parsed).toHaveProperty("affectedArtifacts");
      expect(Array.isArray(parsed.affectedArtifacts)).toBe(true);
    });
  });

  describe("impact under format 4.0 (6e)", () => {
    const SHOP_3X = `orm_version: "3.0"
model:
  name: Shop
  object_types:
    - { id: ot-1, name: Customer, kind: entity, reference_mode: nr }
`;
    const exportOf = (elementId: string) => ({
      artifact: "schema.sql",
      format: "ddl",
      exportedAt: "2026-11-04T00:00:00Z",
      modelHash: "h",
      sources: [{ elementId, elementType: "EntityType", elementName: "Customer" }],
      sourceModel: "shop.orm.yaml",
    });

    it("finds by an id the 3.x file states the export that recorded its 4.0 id", async () => {
      const modelPath = path.join(tempDir, "shop.orm.yaml");
      fs.writeFileSync(modelPath, SHOP_3X);
      writeManifest(tempDir, {
        version: 2,
        sourceModel: "shop.orm.yaml",
        sourceModelHash: "h",
        exports: [exportOf("Customer")],
      });
      const result = await runCli(["lineage", "impact", modelPath, "--element", "ot-1"]);
      expect(result.stdout).toContain("1 artifact(s) affected");
      expect(result.exitCode).toBe(0);
    });

    it("says when the model did not load, since a 3.x id is then not read", async () => {
      const modelPath = path.join(tempDir, "shop.orm.yaml");
      fs.writeFileSync(modelPath, "model: [not a model\n");
      writeManifest(tempDir, {
        version: 2,
        sourceModel: "shop.orm.yaml",
        sourceModelHash: "h",
        exports: [exportOf("Customer")],
      });
      const result = await runCli(["lineage", "impact", modelPath, "--element", "ot-1"]);
      expect(result.stdout).toContain("The model did not load");
      // The export does depend on ot-1 (Customer's 3.x id), so the answer
      // must not read as "nothing depends" (the pr-review on 6e).
      expect(result.stdout).not.toContain("No artifacts depend");
      expect(result.stdout).toContain("No artifact records this id under a 4.0 id.");
    });

    it("names the elements a shared 3.x id names, rather than saying none depend", async () => {
      const modelPath = path.join(tempDir, "shop.orm.yaml");
      fs.writeFileSync(
        modelPath,
        `orm_version: "3.0"
model:
  name: Shop
  object_types:
    - { id: x1, name: Person, kind: entity, reference_mode: nr }
  fact_types:
    - id: x1
      name: Person smokes
      roles:
        - { id: r1, player: x1, role_name: smokes }
      readings: ["{0} smokes"]
`,
      );
      writeManifest(tempDir, {
        version: 2,
        sourceModel: "shop.orm.yaml",
        sourceModelHash: "h",
        exports: [exportOf("Person")],
      });
      const result = await runCli(["lineage", "impact", modelPath, "--element", "x1"]);
      expect(result.stdout).not.toContain("No artifacts depend");
      expect(result.stdout).toContain(
        '"x1" is a 3.x id the file states for more than one element (Person, Person_smokes), '
          + "so exports written under 3.x ids that hold it are not matched by it.",
      );
    });

    it("says the model did not load in json too (Copilot, on 6e)", async () => {
      const modelPath = path.join(tempDir, "shop.orm.yaml");
      fs.writeFileSync(modelPath, "model: [not a model\n");
      writeManifest(tempDir, {
        version: 2,
        sourceModel: "shop.orm.yaml",
        sourceModelHash: "h",
        exports: [exportOf("Customer")],
      });
      const result = await runCli([
        "lineage",
        "impact",
        modelPath,
        "--element",
        "ot-1",
        "--format",
        "json",
      ]);
      expect(JSON.parse(result.stdout).modelDidNotLoad).toBe(true);
      fs.writeFileSync(modelPath, SHOP_3X);
      const loaded = await runCli([
        "lineage",
        "impact",
        modelPath,
        "--element",
        "ot-1",
        "--format",
        "json",
      ]);
      expect(JSON.parse(loaded.stdout)).not.toHaveProperty("modelDidNotLoad");
    });

    it("says nothing about loading when there is no manifest, since no model is read", async () => {
      const modelPath = path.join(tempDir, "shop.orm.yaml");
      fs.writeFileSync(modelPath, SHOP_3X);
      const result = await runCli(["lineage", "impact", modelPath, "--element", "ot-1"]);
      expect(result.stdout).not.toContain("did not load");
      expect(result.stdout).toContain("No artifacts depend on this element");
    });

    it("names the exports made under 3.x ids rather than reporting nothing", async () => {
      // A 4.0 model: it knows no 3.x id, so whether the export used one is unknown.
      const modelPath = path.join(tempDir, "shop.orm.yaml");
      fs.writeFileSync(
        modelPath,
        SHOP_3X.replace('"3.0"', '"4.0"').replace("id: ot-1", "id: Customer"),
      );
      fs.mkdirSync(path.join(tempDir, ".barwise"), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, ".barwise/lineage.yaml"),
        serializeManifest({
          version: 1,
          sourceModel: "shop.orm.yaml",
          sourceModelHash: "h",
          exports: [exportOf("some-uuid")],
        }),
      );
      const result = await runCli(["lineage", "impact", modelPath, "--element", "Customer"]);
      // Not "No artifacts depend", which would read as safe.
      expect(result.stdout).not.toContain("No artifacts depend");
      expect(result.stdout).toContain("No artifact recorded under 4.0 ids depends on this element");
      expect(result.stdout).toContain(
        "1 artifact(s) were exported under 3.x ids, so whether they depend on it is unknown; "
          + "re-export them: schema.sql",
      );
    });
  });

  describe("show", () => {
    it("reports no manifest when none exists", async () => {
      const modelPath = path.join(tempDir, "test.orm.yaml");
      fs.copyFileSync(`${fixtures}/simple.orm.yaml`, modelPath);

      const result = await runCli(["lineage", "show", modelPath]);

      expect(result.stdout).toContain("No lineage manifest found");
      expect(result.exitCode).toBe(0);
    });

    it("displays manifest contents in text format", async () => {
      const modelPath = path.join(tempDir, "test.orm.yaml");
      fs.copyFileSync(`${fixtures}/simple.orm.yaml`, modelPath);

      const model = loadModel(modelPath);
      const modelHash = hashModel(model);

      const manifest: LineageManifest = {
        version: 2,
        sourceModel: "test.orm.yaml",
        sourceModelHash: modelHash,
        exports: [
          {
            artifact: "schema.sql",
            format: "ddl",
            exportedAt: "2026-03-06T12:00:00Z",
            modelHash,
            sources: [
              {
                elementId: "Customer",
                elementType: "EntityType",
                elementName: "Game",
              },
            ],
          },
        ],
      };

      writeManifest(tempDir, manifest);

      const result = await runCli(["lineage", "show", modelPath]);

      expect(result.stdout).toContain("Lineage Manifest");
      expect(result.stdout).toContain("Last exported from: test.orm.yaml");
      expect(result.stdout).toContain("Exports: 1");
      expect(result.stdout).toContain("schema.sql");
      expect(result.stdout).toContain("Format: ddl");
      // Written before exports named their model (iri-identity 6a).
      expect(result.stdout).toContain("Model: (none recorded)");
      expect(result.stdout).toContain("Sources: 1 element(s)");
      expect(result.exitCode).toBe(0);
    });

    it("outputs JSON with --format json", async () => {
      const modelPath = path.join(tempDir, "test.orm.yaml");
      fs.copyFileSync(`${fixtures}/simple.orm.yaml`, modelPath);

      const model = loadModel(modelPath);
      const modelHash = hashModel(model);

      const manifest: LineageManifest = {
        version: 2,
        sourceModel: "test.orm.yaml",
        sourceModelHash: modelHash,
        exports: [
          {
            artifact: "schema.sql",
            format: "ddl",
            exportedAt: "2026-03-06T12:00:00Z",
            modelHash,
            sources: [],
            sourceModel: "test.orm.yaml",
          },
        ],
      };

      writeManifest(tempDir, manifest);

      const result = await runCli([
        "lineage",
        "show",
        modelPath,
        "--format",
        "json",
      ]);

      const parsed = JSON.parse(result.stdout);
      expect(parsed).toHaveProperty("version", 2);
      expect(parsed).toHaveProperty("sourceModel");
      expect(parsed).toHaveProperty("sourceModelHash");
      expect(parsed).toHaveProperty("exports");
      expect(Array.isArray(parsed.exports)).toBe(true);
    });
  });
});
