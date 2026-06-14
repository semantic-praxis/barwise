/**
 * Tests for code format registration.
 */
import { clearFormats, getImporter, listImporters } from "@barwise/core";
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
});
