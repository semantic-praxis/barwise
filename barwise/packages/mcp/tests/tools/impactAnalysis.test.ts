/**
 * Tests for the impact_analysis tool.
 */
import { OrmYamlSerializer } from "@barwise/core";
import { hashModel, type LineageManifest } from "@barwise/core/lineage";
import * as fs from "node:fs";
import * as os from "node:os";
import { dirname, resolve } from "node:path";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeImpactAnalysis } from "../../src/tools/impactAnalysis.js";
import { writeManifest } from "../helpers/manifestFixture.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");

describe("impact_analysis tool", () => {
  let tempDir: string;
  const serializer = new OrmYamlSerializer();

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "barwise-mcp-impact-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns no affected artifacts when element not in manifest", () => {
    const modelPath = path.join(tempDir, "test.orm.yaml");
    fs.copyFileSync(`${fixtures}/simple.orm.yaml`, modelPath);

    const yaml = fs.readFileSync(modelPath, "utf-8");
    const model = serializer.deserialize(yaml);
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

    const elementId = "550e8400-e29b-41d4-a716-446655440000";
    const result = executeImpactAnalysis(modelPath, elementId);
    const parsed = JSON.parse(result.content[0]!.text);

    expect(parsed.changedElement).toBe(elementId);
    expect(parsed.affectedArtifacts).toHaveLength(0);
  });

  it("returns affected artifacts when element referenced", () => {
    const modelPath = path.join(tempDir, "test.orm.yaml");
    fs.copyFileSync(`${fixtures}/simple.orm.yaml`, modelPath);

    const yaml = fs.readFileSync(modelPath, "utf-8");
    const model = serializer.deserialize(yaml);
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
        {
          artifact: "models/player.sql",
          format: "dbt",
          exportedAt: "2026-03-06T12:00:00Z",
          modelHash,
          sources: [
            {
              elementId: "999e8400-e29b-41d4-a716-446655440999",
              elementType: "EntityType",
              elementName: "Player",
            },
          ],
        },
      ],
    };

    writeManifest(tempDir, manifest);

    const result = executeImpactAnalysis(modelPath, elementId);
    const parsed = JSON.parse(result.content[0]!.text);

    expect(parsed.changedElement).toBe(elementId);
    expect(parsed.affectedArtifacts).toHaveLength(2);

    const artifactNames = parsed.affectedArtifacts.map((a: { artifact: string; }) => a.artifact);
    expect(artifactNames).toContain("schema.sql");
    expect(artifactNames).toContain("models/game.sql");
    expect(artifactNames).not.toContain("models/player.sql");

    const schemaSql = parsed.affectedArtifacts.find((a: { artifact: string; }) =>
      a.artifact === "schema.sql"
    );
    expect(schemaSql.format).toBe("ddl");
    expect(schemaSql.relationship).toContain("derived from entity type Game");
  });

  it("works with inline YAML content", () => {
    const yaml = fs.readFileSync(`${fixtures}/simple.orm.yaml`, "utf-8");
    const model = serializer.deserialize(yaml);
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
      ],
    };

    writeManifest(process.cwd(), manifest);

    try {
      const result = executeImpactAnalysis(yaml, elementId);
      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.changedElement).toBe(elementId);
      expect(parsed.affectedArtifacts).toHaveLength(1);
    } finally {
      // Clean up manifest in cwd
      const manifestPath = path.join(process.cwd(), ".barwise", "lineage.yaml");
      if (fs.existsSync(manifestPath)) {
        fs.unlinkSync(manifestPath);
        const dir = path.dirname(manifestPath);
        if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir);
        }
      }
    }
  });

  it("handles different element types correctly", () => {
    const modelPath = path.join(tempDir, "test.orm.yaml");
    fs.copyFileSync(`${fixtures}/simple.orm.yaml`, modelPath);

    const yaml = fs.readFileSync(modelPath, "utf-8");
    const model = serializer.deserialize(yaml);
    const modelHash = hashModel(model);

    const constraintId = "c1111111-e29b-41d4-a716-446655440000";
    const valueTypeId = "v2222222-e29b-41d4-a716-446655440000";

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
              elementId: constraintId,
              elementType: "Constraint",
              elementName: "UC: Game is identified by GameId",
            },
          ],
        },
        {
          artifact: "types/status.avsc",
          format: "avro",
          exportedAt: "2026-03-06T12:00:00Z",
          modelHash,
          sources: [
            {
              elementId: valueTypeId,
              elementType: "ValueType",
              elementName: "GameStatus",
            },
          ],
        },
      ],
    };

    writeManifest(tempDir, manifest);

    // Test constraint impact
    const constraintResult = executeImpactAnalysis(modelPath, constraintId);
    const constraintParsed = JSON.parse(constraintResult.content[0]!.text);
    expect(constraintParsed.affectedArtifacts).toHaveLength(1);
    expect(constraintParsed.affectedArtifacts[0].relationship).toContain("enforces constraint");

    // Test value type impact
    const valueTypeResult = executeImpactAnalysis(modelPath, valueTypeId);
    const valueTypeParsed = JSON.parse(valueTypeResult.content[0]!.text);
    expect(valueTypeParsed.affectedArtifacts).toHaveLength(1);
    expect(valueTypeParsed.affectedArtifacts[0].relationship).toContain("uses value type");
  });

  it("returns content in MCP format", () => {
    const modelPath = path.join(tempDir, "test.orm.yaml");
    fs.copyFileSync(`${fixtures}/simple.orm.yaml`, modelPath);

    const yaml = fs.readFileSync(modelPath, "utf-8");
    const model = serializer.deserialize(yaml);
    const modelHash = hashModel(model);

    const manifest: LineageManifest = {
      version: 1,
      sourceModel: "test.orm.yaml",
      sourceModelHash: modelHash,
      exports: [],
    };

    writeManifest(tempDir, manifest);

    const result = executeImpactAnalysis(modelPath, "550e8400-e29b-41d4-a716-446655440000");

    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");
    expect(typeof result.content[0]!.text).toBe("string");
    expect(() => JSON.parse(result.content[0]!.text)).not.toThrow();
  });
});
