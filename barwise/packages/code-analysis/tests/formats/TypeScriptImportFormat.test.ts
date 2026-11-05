/**
 * Tests for the TypeScriptImportFormat.
 *
 * Uses a fixture TypeScript project to verify end-to-end import behavior
 * without requiring a language server (regex fallback mode).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TypeScriptImportFormat } from "../../src/formats/TypeScriptImportFormat.js";

describe("TypeScriptImportFormat", () => {
  const importer = new TypeScriptImportFormat();
  let fixtureDir: string;

  beforeEach(() => {
    fixtureDir = join(tmpdir(), `barwise-ts-test-${Date.now()}`);
    mkdirSync(fixtureDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it("has correct name and inputKind", () => {
    expect(importer.name).toBe("typescript");
    expect(importer.inputKind).toBe("directory");
  });

  it("has parseAsync but not parse", () => {
    expect(importer.parseAsync).toBeDefined();
    expect(importer.parse).toBeUndefined();
  });

  it("extracts enums as value types", async () => {
    writeFileSync(
      join(fixtureDir, "models.ts"),
      `export enum OrderStatus {
  Draft,
  Submitted,
  Fulfilled,
  Cancelled
}`,
    );

    const result = await importer.parseAsync!(fixtureDir);

    expect(result.model).toBeDefined();
    const orderStatus = result.model.getObjectTypeByName("OrderStatus");
    expect(orderStatus).toBeDefined();
    expect(orderStatus!.kind).toBe("value");
  });

  it("extracts interfaces as entity types", async () => {
    writeFileSync(
      join(fixtureDir, "models.ts"),
      `export interface Order {
  id: string;
  total: number;
}

export interface Customer {
  id: string;
  name: string;
}`,
    );

    const result = await importer.parseAsync!(fixtureDir);

    expect(result.model.getObjectTypeByName("Order")).toBeDefined();
    expect(result.model.getObjectTypeByName("Customer")).toBeDefined();
  });

  it("extracts string literal union types as value types", async () => {
    writeFileSync(
      join(fixtureDir, "types.ts"),
      `export type PaymentMethod = "credit_card" | "debit_card" | "cash";`,
    );

    const result = await importer.parseAsync!(fixtureDir);

    const paymentMethod = result.model.getObjectTypeByName("PaymentMethod");
    expect(paymentMethod).toBeDefined();
    expect(paymentMethod!.kind).toBe("value");
  });

  it("returns warnings when no types found", async () => {
    writeFileSync(join(fixtureDir, "empty.ts"), "// empty file\n");

    const result = await importer.parseAsync!(fixtureDir);

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.confidence).toBe("low");
  });

  it("uses custom model name from options", async () => {
    writeFileSync(
      join(fixtureDir, "models.ts"),
      `export enum Status { Active, Inactive }`,
    );

    const result = await importer.parseAsync!(fixtureDir, {
      modelName: "My Domain",
    });

    expect(result.model.name).toBe("My Domain");
  });

  it("excludes node_modules and dist", async () => {
    mkdirSync(join(fixtureDir, "node_modules"), { recursive: true });
    mkdirSync(join(fixtureDir, "dist"), { recursive: true });
    writeFileSync(
      join(fixtureDir, "node_modules", "lib.ts"),
      `export enum LibStatus { A, B }`,
    );
    writeFileSync(
      join(fixtureDir, "dist", "built.ts"),
      `export enum BuiltStatus { X, Y }`,
    );
    writeFileSync(
      join(fixtureDir, "models.ts"),
      `export enum AppStatus { Active, Inactive }`,
    );

    const result = await importer.parseAsync!(fixtureDir);

    // Should find AppStatus but not LibStatus or BuiltStatus
    expect(result.model.getObjectTypeByName("AppStatus")).toBeDefined();
    expect(result.model.getObjectTypeByName("LibStatus")).toBeUndefined();
    expect(result.model.getObjectTypeByName("BuiltStatus")).toBeUndefined();
  });

  it("handles mixed enum, interface, and type alias", async () => {
    writeFileSync(
      join(fixtureDir, "domain.ts"),
      `
export enum Priority { Low, Medium, High }

export interface Order {
  id: string;
  priority: Priority;
}

export type Region = "US" | "EU" | "APAC";
`,
    );

    const result = await importer.parseAsync!(fixtureDir);

    expect(result.model.getObjectTypeByName("Priority")).toBeDefined();
    expect(result.model.getObjectTypeByName("Order")).toBeDefined();
    expect(result.model.getObjectTypeByName("Region")).toBeDefined();
    expect(result.confidence).not.toBe("low");
  });

  it("reports LSP fallback in warnings when server unavailable", async () => {
    writeFileSync(join(fixtureDir, "model.ts"), `export enum X { A }`);

    const result = await importer.parseAsync!(fixtureDir);

    // Without a real TS server installed, should get a fallback warning
    expect(result.warnings.some((w) => w.includes("language server") || w.includes("regex"))).toBe(
      true,
    );
  });

  describe("guidingModel support", () => {
    it("filters types to match guiding model entities", async () => {
      // Create a guiding model with only Order as an entity
      const guidingYaml = `
orm_version: "4.0"
model:
  name: Guiding
  object_types:
    - id: Order
      name: Order
      kind: entity
      reference_mode: id
`;
      writeFileSync(join(fixtureDir, "guide.orm.yaml"), guidingYaml);

      // Create source with multiple types
      writeFileSync(
        join(fixtureDir, "models.ts"),
        `
export interface Order { id: string; total: number; }
export interface Customer { id: string; name: string; }
export interface Product { id: string; sku: string; }
export enum Status { Active, Inactive }
`,
      );

      const result = await importer.parseAsync!(fixtureDir, {
        guidingModel: join(fixtureDir, "guide.orm.yaml"),
      });

      // Order should be kept (matches guiding entity)
      expect(result.model.getObjectTypeByName("Order")).toBeDefined();
      // Status enum should be kept (enums always kept)
      expect(result.model.getObjectTypeByName("Status")).toBeDefined();
      // Customer and Product should be filtered out
      expect(result.model.getObjectTypeByName("Customer")).toBeUndefined();
      expect(result.model.getObjectTypeByName("Product")).toBeUndefined();
    });

    it("keeps all types when guidingModel is not provided", async () => {
      writeFileSync(
        join(fixtureDir, "models.ts"),
        `
export interface Order { id: string; }
export interface Customer { id: string; }
`,
      );

      const result = await importer.parseAsync!(fixtureDir);

      expect(result.model.getObjectTypeByName("Order")).toBeDefined();
      expect(result.model.getObjectTypeByName("Customer")).toBeDefined();
    });

    it("keeps all types when guidingModel file does not exist", async () => {
      writeFileSync(
        join(fixtureDir, "models.ts"),
        `
export interface Order { id: string; }
export interface Customer { id: string; }
`,
      );

      const result = await importer.parseAsync!(fixtureDir, {
        guidingModel: "/nonexistent/model.orm.yaml",
      });

      // Non-existent guiding model should not filter anything
      expect(result.model.getObjectTypeByName("Order")).toBeDefined();
      expect(result.model.getObjectTypeByName("Customer")).toBeDefined();
    });
  });
});
