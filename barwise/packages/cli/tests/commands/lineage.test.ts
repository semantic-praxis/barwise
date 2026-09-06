/**
 * Tests for the lineage command group.
 */
import { hashModel, type LineageManifest } from "@barwise/core/lineage";
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
        version: 1,
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
        version: 1,
        sourceModel: "test.orm.yaml",
        sourceModelHash: oldHash,
        exports: [
          {
            artifact: "schema.sql",
            format: "ddl",
            exportedAt: "2026-03-06T12:00:00Z",
            modelHash: oldHash,
            sources: [],
          },
          {
            artifact: "models/game.sql",
            format: "dbt",
            exportedAt: "2026-03-06T12:00:00Z",
            modelHash: oldHash,
            sources: [],
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
        version: 1,
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
        version: 1,
        sourceModel: "test.orm.yaml",
        sourceModelHash: modelHash,
        exports: [
          {
            artifact: "stale.sql",
            format: "ddl",
            exportedAt: "2026-03-06T12:00:00Z",
            modelHash: oldHash,
            sources: [],
          },
          {
            artifact: "fresh.sql",
            format: "ddl",
            exportedAt: "2026-03-06T12:00:00Z",
            modelHash,
            sources: [],
          },
        ],
      };
      writeManifest(tempDir, manifest);

      const result = await runCli(["lineage", "status", modelPath]);

      expect(result.stdout).toContain("1 stale artifact(s) found");
      expect(result.stdout).toContain("1 artifact(s) still fresh.");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("impact", () => {
    it("reports no affected artifacts when element not in manifest", async () => {
      const modelPath = path.join(tempDir, "test.orm.yaml");
      fs.copyFileSync(`${fixtures}/simple.orm.yaml`, modelPath);

      const model = loadModel(modelPath);
      const modelHash = hashModel(model);

      const manifest: LineageManifest = {
        version: 1,
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
      };

      writeManifest(tempDir, manifest);

      const result = await runCli([
        "lineage",
        "impact",
        modelPath,
        "--element",
        "550e8400-e29b-41d4-a716-446655440000",
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

      const elementId = "550e8400-e29b-41d4-a716-446655440000";

      const manifest: LineageManifest = {
        version: 1,
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
        version: 1,
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
        "550e8400-e29b-41d4-a716-446655440000",
        "--format",
        "json",
      ]);

      const parsed = JSON.parse(result.stdout);
      expect(parsed).toHaveProperty("changedElement");
      expect(parsed).toHaveProperty("affectedArtifacts");
      expect(Array.isArray(parsed.affectedArtifacts)).toBe(true);
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
        version: 1,
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
                elementId: "550e8400-e29b-41d4-a716-446655440000",
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
      expect(result.stdout).toContain("Source Model: test.orm.yaml");
      expect(result.stdout).toContain("Exports: 1");
      expect(result.stdout).toContain("schema.sql");
      expect(result.stdout).toContain("Format: ddl");
      expect(result.stdout).toContain("Sources: 1 element(s)");
      expect(result.exitCode).toBe(0);
    });

    it("outputs JSON with --format json", async () => {
      const modelPath = path.join(tempDir, "test.orm.yaml");
      fs.copyFileSync(`${fixtures}/simple.orm.yaml`, modelPath);

      const model = loadModel(modelPath);
      const modelHash = hashModel(model);

      const manifest: LineageManifest = {
        version: 1,
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
      expect(parsed).toHaveProperty("version", 1);
      expect(parsed).toHaveProperty("sourceModel");
      expect(parsed).toHaveProperty("sourceModelHash");
      expect(parsed).toHaveProperty("exports");
      expect(Array.isArray(parsed.exports)).toBe(true);
    });
  });
});
