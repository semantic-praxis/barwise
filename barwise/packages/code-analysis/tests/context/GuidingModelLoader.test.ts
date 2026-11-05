/**
 * Tests for the GuidingModelLoader.
 *
 * Verifies loading of entity names from ORM model files and
 * filtering of type definitions by guiding model entities.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  filterByGuidingModel,
  loadGuidingEntityNames,
} from "../../src/context/GuidingModelLoader.js";
import type { TypeDefinitionContext } from "../../src/types.js";

describe("loadGuidingEntityNames", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `guiding-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads entity type names from a valid ORM model", () => {
    const modelYaml = `
orm_version: "4.0"
model:
  name: Test Model
  object_types:
    - id: Customer
      name: Customer
      kind: entity
      reference_mode: id
    - id: Order
      name: Order
      kind: entity
      reference_mode: id
    - id: OrderStatus
      name: OrderStatus
      kind: value
      data_type:
        name: text
      value_constraint:
        values: [Draft, Submitted]
`;
    const modelPath = join(tempDir, "test.orm.yaml");
    writeFileSync(modelPath, modelYaml);

    const names = loadGuidingEntityNames(modelPath);

    expect(names.size).toBe(2);
    expect(names.has("Customer")).toBe(true);
    expect(names.has("Order")).toBe(true);
    // Value types are not included
    expect(names.has("OrderStatus")).toBe(false);
  });

  it("returns empty set for non-existent file", () => {
    const names = loadGuidingEntityNames("/nonexistent/path/model.orm.yaml");
    expect(names.size).toBe(0);
  });

  it("returns empty set for invalid YAML", () => {
    const modelPath = join(tempDir, "bad.orm.yaml");
    writeFileSync(modelPath, "{{{{not valid yaml");

    const names = loadGuidingEntityNames(modelPath);
    expect(names.size).toBe(0);
  });

  it("returns empty set for model with no entity types", () => {
    const modelYaml = `
orm_version: "4.0"
model:
  name: Values Only
  object_types:
    - id: Status
      name: Status
      kind: value
      data_type:
        name: text
`;
    const modelPath = join(tempDir, "values.orm.yaml");
    writeFileSync(modelPath, modelYaml);

    const names = loadGuidingEntityNames(modelPath);
    expect(names.size).toBe(0);
  });
});

describe("filterByGuidingModel", () => {
  const makeType = (
    name: string,
    kind: "enum" | "interface" | "class" | "type_alias",
  ): TypeDefinitionContext => ({
    name,
    kind,
    filePath: "test.ts",
    startLine: 1,
    endLine: 5,
    sourceText: "",
    referencedBy: [],
  });

  it("returns all types when guiding set is empty", () => {
    const types = [
      makeType("Order", "interface"),
      makeType("Customer", "class"),
      makeType("Status", "enum"),
    ];

    const filtered = filterByGuidingModel(types, new Set());
    expect(filtered).toHaveLength(3);
  });

  it("keeps only matching entities and all enums", () => {
    const types = [
      makeType("Order", "interface"),
      makeType("Customer", "class"),
      makeType("Invoice", "interface"),
      makeType("Status", "enum"),
      makeType("Region", "type_alias"),
    ];

    const filtered = filterByGuidingModel(types, new Set(["Order", "Customer"]));

    expect(filtered).toHaveLength(4); // Order, Customer, Status (enum), Region (type_alias)
    const names = filtered.map((t) => t.name);
    expect(names).toContain("Order");
    expect(names).toContain("Customer");
    expect(names).toContain("Status");
    expect(names).toContain("Region");
    expect(names).not.toContain("Invoice");
  });

  it("matches entity names case-insensitively", () => {
    const types = [
      makeType("order", "class"),
      makeType("CUSTOMER", "interface"),
      makeType("Unknown", "class"),
    ];

    const filtered = filterByGuidingModel(types, new Set(["Order", "Customer"]));
    const names = filtered.map((t) => t.name);

    expect(names).toContain("order");
    expect(names).toContain("CUSTOMER");
    expect(names).not.toContain("Unknown");
  });

  it("filters out non-matching interfaces and classes", () => {
    const types = [
      makeType("Product", "interface"),
      makeType("Warehouse", "class"),
    ];

    const filtered = filterByGuidingModel(types, new Set(["Order"]));
    expect(filtered).toHaveLength(0);
  });
});
