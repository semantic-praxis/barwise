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
  it("loads a document at the current version [adr:schema-versioning#version-signal]", () => {
    const model = serializer.deserialize(modelYaml(CURRENT_ORM_VERSION));
    expect(model.name).toBe("T");
  });

  it("migrates a 1.0 document forward to the current version [adr:schema-versioning#load-forward]", () => {
    const model = serializer.deserialize(modelYaml("1.0"));
    expect(model.name).toBe("T");
    // The additive 1.0 -> 1.1 migration restamps the version; re-serializing
    // a migrated model emits the current version, not the original 1.0.
    expect(serializer.serialize(model)).toContain(`orm_version: "${CURRENT_ORM_VERSION}"`);
  });

  it("rejects a newer version with an upgrade message [adr:schema-versioning#version-signal]", () => {
    expect(() => serializer.deserialize(modelYaml("5.0"))).toThrow(DeserializationError);
    expect(() => serializer.deserialize(modelYaml("5.0"))).toThrow(/newer barwise/);
    // The old cryptic schema-const message must no longer surface.
    expect(() => serializer.deserialize(modelYaml("5.0"))).not.toThrow(/must be equal to constant/);
  });

  it("refuses a document with no orm_version, naming the missing field [adr:schema-versioning#version-signal]", () => {
    // A file with no version is not read as the oldest or the newest: either
    // guess would put a version on a file that never stated one, and a
    // guessed current version would let a pre-versioning file reach the
    // current reader as if it were valid.
    const unstamped = "model:\n  name: T\n";
    expect(() => serializer.deserialize(unstamped)).toThrow(DeserializationError);
    expect(() => serializer.deserialize(unstamped)).toThrow(/orm_version is missing/);
  });

  it("rejects an unknown older version with a no-path message", () => {
    expect(() => serializer.deserialize(modelYaml("0.9"))).toThrow(/no migration path/);
  });

  it("names the offending version in the error", () => {
    expect(() => serializer.deserialize(modelYaml("9.9"))).toThrow(/orm_version "9\.9"/);
  });

  it("stamps the current version on serialized output [adr:schema-versioning#version-signal]", () => {
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
