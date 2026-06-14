/**
 * Tests for the dbt format descriptor and its registration with the
 * unified registry. These cover the connector's public contract: the
 * shape of the `dbt` descriptor and that `registerDbtFormats()` plugs
 * it into core's registry.
 */
import { clearFormats, getExporter, getFormat, getImporter, listFormats } from "@barwise/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createDbtFormat, registerDbtFormats } from "../src/registration.js";

describe("createDbtFormat", () => {
  it("has name 'dbt'", () => {
    expect(createDbtFormat().name).toBe("dbt");
  });

  it("has a description", () => {
    expect(createDbtFormat().description).toBeTruthy();
  });

  it("has both an importer and an exporter", () => {
    const descriptor = createDbtFormat();
    expect(descriptor.importer).toBeDefined();
    expect(descriptor.exporter).toBeDefined();
  });

  it("importer is directory-based (parseAsync, no parse)", () => {
    const descriptor = createDbtFormat();
    expect(descriptor.importer!.inputKind).toBe("directory");
    expect(descriptor.importer!.parseAsync).toBeDefined();
    expect(descriptor.importer!.parse).toBeUndefined();
  });

  it("exporter exposes an export method", () => {
    expect(typeof createDbtFormat().exporter!.export).toBe("function");
  });
});

describe("registerDbtFormats", () => {
  beforeEach(() => {
    clearFormats();
  });

  it("registers the dbt format with the registry", () => {
    registerDbtFormats();

    expect(getFormat("dbt")).toBeDefined();
    expect(getImporter("dbt")).toBeDefined();
    expect(getExporter("dbt")).toBeDefined();
    expect(listFormats()).toHaveLength(1);
  });

  it("is idempotent -- safe to call multiple times", () => {
    registerDbtFormats();
    registerDbtFormats();
    registerDbtFormats();

    expect(listFormats()).toHaveLength(1);
  });
});
