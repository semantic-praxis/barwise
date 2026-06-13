/**
 * Tests for how OrmYamlSerializer.deserialize handles the document
 * `orm_version`: current versions load, unsupported versions throw a
 * clear DeserializationError instead of the schema's cryptic `const`
 * mismatch, and the emitted version stays the single source of truth.
 */
import { describe, expect, it } from "vitest";
import {
  DeserializationError,
  OrmYamlSerializer,
} from "../../src/serialization/OrmYamlSerializer.js";
import { CURRENT_ORM_VERSION } from "../../src/serialization/schemaVersion.js";

const serializer = new OrmYamlSerializer();

function modelYaml(version: string): string {
  return `orm_version: "${version}"\nmodel:\n  name: T\n`;
}

describe("OrmYamlSerializer version handling", () => {
  it("loads a document at the current version", () => {
    const model = serializer.deserialize(modelYaml(CURRENT_ORM_VERSION));
    expect(model.name).toBe("T");
  });

  it("rejects a newer version with an upgrade message", () => {
    expect(() => serializer.deserialize(modelYaml("2.0"))).toThrow(DeserializationError);
    expect(() => serializer.deserialize(modelYaml("2.0"))).toThrow(/newer barwise/);
    // The old cryptic schema-const message must no longer surface.
    expect(() => serializer.deserialize(modelYaml("2.0"))).not.toThrow(/must be equal to constant/);
  });

  it("rejects an unknown older version with a no-path message", () => {
    expect(() => serializer.deserialize(modelYaml("0.9"))).toThrow(/no migration path/);
  });

  it("names the offending version in the error", () => {
    expect(() => serializer.deserialize(modelYaml("9.9"))).toThrow(/orm_version "9\.9"/);
  });

  it("stamps the current version on serialized output", () => {
    const model = serializer.deserialize(modelYaml(CURRENT_ORM_VERSION));
    expect(serializer.serialize(model)).toContain(`orm_version: "${CURRENT_ORM_VERSION}"`);
  });

  it("still reports schema errors for malformed documents", () => {
    // Missing `model` -- version is current, so it reaches schema
    // validation and fails there as before.
    const yaml = `orm_version: "${CURRENT_ORM_VERSION}"\n`;
    expect(() => serializer.deserialize(yaml)).toThrow(DeserializationError);
  });
});
