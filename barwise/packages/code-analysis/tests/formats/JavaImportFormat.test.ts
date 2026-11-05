/**
 * Tests for the JavaImportFormat.
 *
 * Uses fixture Java source files to verify end-to-end import behavior
 * without requiring a language server (regex fallback mode).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JavaImportFormat } from "../../src/formats/JavaImportFormat.js";

describe("JavaImportFormat", () => {
  const importer = new JavaImportFormat();
  let fixtureDir: string;

  beforeEach(() => {
    fixtureDir = join(tmpdir(), `barwise-java-test-${Date.now()}`);
    mkdirSync(fixtureDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it("has correct name and inputKind", () => {
    expect(importer.name).toBe("java");
    expect(importer.inputKind).toBe("directory");
  });

  it("has parseAsync but not parse", () => {
    expect(importer.parseAsync).toBeDefined();
    expect(importer.parse).toBeUndefined();
  });

  it("extracts @Entity classes as entity types", async () => {
    writeFileSync(
      join(fixtureDir, "Customer.java"),
      `
@Entity
public class Customer {
    @Id
    private Long id;
    private String name;
}`,
    );

    const result = await importer.parseAsync!(fixtureDir);

    expect(result.model).toBeDefined();
    const customer = result.model.getObjectTypeByName("Customer");
    expect(customer).toBeDefined();
    expect(customer!.kind).toBe("entity");
  });

  it("extracts enums as value types", async () => {
    writeFileSync(
      join(fixtureDir, "OrderStatus.java"),
      `
public enum OrderStatus {
    DRAFT,
    SUBMITTED,
    FULFILLED,
    CANCELLED
}`,
    );

    const result = await importer.parseAsync!(fixtureDir);

    const orderStatus = result.model.getObjectTypeByName("OrderStatus");
    expect(orderStatus).toBeDefined();
    expect(orderStatus!.kind).toBe("value");
  });

  it("extracts @ManyToOne as fact types", async () => {
    writeFileSync(
      join(fixtureDir, "Order.java"),
      `
@Entity
public class Order {
    @Id
    private Long id;
    @ManyToOne
    private Customer customer;
}`,
    );
    writeFileSync(
      join(fixtureDir, "Customer.java"),
      `
@Entity
public class Customer {
    @Id
    private Long id;
    private String name;
}`,
    );

    const result = await importer.parseAsync!(fixtureDir);

    expect(result.model.factTypes.length).toBeGreaterThanOrEqual(1);
  });

  it("tracks annotation constraints in warnings", async () => {
    writeFileSync(
      join(fixtureDir, "Product.java"),
      `
@Entity
public class Product {
    @Id
    private Long id;
    @NotNull
    @Size(min = 1, max = 100)
    private String name;
}`,
    );

    const result = await importer.parseAsync!(fixtureDir);

    // @NotNull and @Size should generate warnings
    expect(result.warnings.some((w) => w.includes("@NotNull"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("@Size"))).toBe(true);
  });

  it("uses custom model name from options", async () => {
    writeFileSync(
      join(fixtureDir, "Status.java"),
      `public enum Status { Active, Inactive }`,
    );

    const result = await importer.parseAsync!(fixtureDir, {
      modelName: "My Java Model",
    });

    expect(result.model.name).toBe("My Java Model");
  });

  it("returns warnings when no types found", async () => {
    writeFileSync(join(fixtureDir, "Empty.java"), "// empty file\n");

    const result = await importer.parseAsync!(fixtureDir);

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.confidence).toBe("low");
  });

  it("excludes build and target directories", async () => {
    mkdirSync(join(fixtureDir, "build", "classes"), { recursive: true });
    mkdirSync(join(fixtureDir, "target"), { recursive: true });
    writeFileSync(
      join(fixtureDir, "build", "classes", "Generated.java"),
      `public enum Generated { A, B }`,
    );
    writeFileSync(
      join(fixtureDir, "target", "Built.java"),
      `public enum Built { X, Y }`,
    );
    writeFileSync(
      join(fixtureDir, "Status.java"),
      `public enum Status { Active, Inactive }`,
    );

    const result = await importer.parseAsync!(fixtureDir);

    expect(result.model.getObjectTypeByName("Status")).toBeDefined();
    expect(result.model.getObjectTypeByName("Generated")).toBeUndefined();
    expect(result.model.getObjectTypeByName("Built")).toBeUndefined();
  });

  it("reports LSP fallback in warnings when server unavailable", async () => {
    writeFileSync(join(fixtureDir, "X.java"), `public enum X { A }`);

    const result = await importer.parseAsync!(fixtureDir);

    expect(result.warnings.some((w) => w.includes("language server") || w.includes("regex"))).toBe(
      true,
    );
  });

  it("infers reference mode from @Id annotation", async () => {
    writeFileSync(
      join(fixtureDir, "Employee.java"),
      `
@Entity
public class Employee {
    @Id
    private Long employeeId;
    private String name;
}`,
    );

    const result = await importer.parseAsync!(fixtureDir);

    const employee = result.model.getObjectTypeByName("Employee");
    expect(employee).toBeDefined();
    expect(employee!.referenceMode).toBe("employeeId");
  });

  describe("guidingModel support", () => {
    it("filters types to match guiding model entities", async () => {
      const guidingYaml = `
orm_version: "4.0"
model:
  name: Guiding
  object_types:
    - id: Customer
      name: Customer
      kind: entity
      reference_mode: id
`;
      writeFileSync(join(fixtureDir, "guide.orm.yaml"), guidingYaml);

      writeFileSync(
        join(fixtureDir, "Customer.java"),
        `@Entity
public class Customer {
    @Id
    private Long id;
    private String name;
}`,
      );
      writeFileSync(
        join(fixtureDir, "Product.java"),
        `@Entity
public class Product {
    @Id
    private Long id;
    private String sku;
}`,
      );
      writeFileSync(
        join(fixtureDir, "Status.java"),
        `public enum Status { Active, Inactive }`,
      );

      const result = await importer.parseAsync!(fixtureDir, {
        guidingModel: join(fixtureDir, "guide.orm.yaml"),
      });

      // Customer matches guiding model
      expect(result.model.getObjectTypeByName("Customer")).toBeDefined();
      // Status enum is always kept
      expect(result.model.getObjectTypeByName("Status")).toBeDefined();
      // Product is filtered out
      expect(result.model.getObjectTypeByName("Product")).toBeUndefined();
    });
  });
});
