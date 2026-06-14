/**
 * Tests for code format registration.
 */
import { clearFormats, getImporter, listImporters, registerBuiltinFormats } from "@barwise/core";
import { beforeEach, describe, expect, it } from "vitest";
import { registerCodeFormats } from "../../src/formats/registration.js";

describe("registerCodeFormats", () => {
  beforeEach(() => {
    clearFormats();
  });

  it("registers TypeScript format", () => {
    registerCodeFormats();

    const importer = getImporter("typescript");
    expect(importer).toBeDefined();
    expect(importer!.name).toBe("typescript");
    expect(importer!.inputKind).toBe("directory");
  });

  it("registers Java format", () => {
    registerCodeFormats();

    const importer = getImporter("java");
    expect(importer).toBeDefined();
    expect(importer!.name).toBe("java");
    expect(importer!.inputKind).toBe("directory");
  });

  it("registers Kotlin format", () => {
    registerCodeFormats();

    const importer = getImporter("kotlin");
    expect(importer).toBeDefined();
    expect(importer!.name).toBe("kotlin");
    expect(importer!.inputKind).toBe("directory");
  });

  it("is idempotent", () => {
    registerCodeFormats();
    registerCodeFormats();
    registerCodeFormats();

    const tsImporters = listImporters().filter((f) => f.name === "typescript");
    const javaImporters = listImporters().filter((f) => f.name === "java");
    const kotlinImporters = listImporters().filter((f) => f.name === "kotlin");
    expect(tsImporters).toHaveLength(1);
    expect(javaImporters).toHaveLength(1);
    expect(kotlinImporters).toHaveLength(1);
  });

  it("works alongside registerBuiltinFormats", () => {
    registerBuiltinFormats();
    registerCodeFormats();

    const allImporters = listImporters();
    const names = allImporters.map((f) => f.name).sort();
    expect(names).toContain("ddl");
    expect(names).toContain("openapi");
    expect(names).toContain("sql");
    expect(names).toContain("typescript");
    expect(names).toContain("java");
    expect(names).toContain("kotlin");
  });
});
