/**
 * The validators, against the three shapes that were actually recorded
 * as goldens and stayed green (barwise-961).
 *
 * These exist separately from the golden test because the golden test
 * can only exercise them on documents the exporters currently produce,
 * which are valid -- so on its own it is a check nobody has seen fail.
 * Each case below is the real defect, minimised.
 */
import { describe, expect, it } from "vitest";
import { claimedFormat, duplicateJsonKeys, formatDefects } from "./formatDefects.js";

const VALID_DDL = `-- Table: patient
CREATE TABLE patient (
  medical_record_number VARCHAR(20) NOT NULL,
  provider_id VARCHAR(20) NOT NULL,
  PRIMARY KEY (medical_record_number),
  FOREIGN KEY (provider_id) REFERENCES doctor (provider_id),
  UNIQUE (provider_id)
);`;

const VALID_AVRO = `# Patient.avsc
{
  "type": "record",
  "name": "Patient",
  "fields": [
    { "name": "medical_record_number", "type": "string" },
    { "name": "provider_id", "type": "string" }
  ]
}`;

const VALID_OPENAPI = `{
  "openapi": "3.0.0",
  "components": {
    "schemas": {
      "Patient": {
        "type": "object",
        "properties": {
          "medical_record_number": { "type": "string" },
          "provider_id": { "type": "string" }
        }
      }
    }
  }
}`;

describe("formatDefects: the three shapes that shipped as valid goldens", () => {
  it("is silent on documents that are instances of their format", () => {
    expect(formatDefects("ddl", VALID_DDL)).toEqual([]);
    expect(formatDefects("avro", VALID_AVRO)).toEqual([]);
    expect(formatDefects("openapi", VALID_OPENAPI)).toEqual([]);
  });

  it("reports a column declared twice in one CREATE TABLE", () => {
    const planted = VALID_DDL.replace(
      "  provider_id VARCHAR(20) NOT NULL,",
      "  provider_id VARCHAR(20) NOT NULL,\n  provider_id VARCHAR(20) NOT NULL,",
    );
    expect(formatDefects("ddl", planted)).toEqual([
      'table patient declares the column "provider_id" twice',
    ]);
  });

  it("does not mistake a table constraint for a repeated column", () => {
    // PRIMARY, FOREIGN and UNIQUE all begin a body line the same way a
    // column does, and the valid fixture above carries one of each. A
    // validator that counted them would report every table as broken.
    expect(formatDefects("ddl", VALID_DDL)).toEqual([]);
  });

  it("reports a CREATE TABLE that never terminates", () => {
    const truncated = VALID_DDL.replace("\n);", "");
    expect(formatDefects("ddl", truncated)).toEqual([
      '1 CREATE TABLE statement(s) but 0 terminate with ");"',
    ]);
  });

  it("reports two Avro record fields of one name", () => {
    const planted = VALID_AVRO.replace(
      '{ "name": "provider_id", "type": "string" }',
      '{ "name": "medical_record_number", "type": "string" }',
    );
    expect(formatDefects("avro", planted)).toContain(
      'Patient declares the field "medical_record_number" twice',
    );
  });

  it("reports an Avro field name Avro would reject", () => {
    const planted = VALID_AVRO.replace('"provider_id"', '"provider-id"');
    expect(formatDefects("avro", planted)).toEqual([
      'Patient has an illegal field name "provider-id"',
    ]);
  });

  it("reports two OpenAPI properties on one key, which JSON.parse hides", () => {
    // The defect that did not fail anything: the second property
    // replaced the first and the file stayed well formed, so a column
    // vanished from the schema with every suite green.
    const planted = VALID_OPENAPI.replace(
      '"provider_id": { "type": "string" }',
      '"medical_record_number": { "type": "integer" }',
    );
    expect(JSON.parse(planted)).toBeTruthy();
    expect(formatDefects("openapi", planted)).toEqual([
      'the OpenAPI document repeats the key "medical_record_number" within one object',
    ]);
  });

  it("reports a document that is not JSON at all", () => {
    expect(formatDefects("openapi", "{ oops")[0]).toMatch(/does not parse as JSON/);
  });
});

describe("duplicateJsonKeys: the scan, where a parse cannot help", () => {
  it("does not confuse an array element with an object key", () => {
    expect(duplicateJsonKeys('{ "a": ["x", "x"], "b": ["x"] }')).toEqual([]);
  });

  it("reports the same key repeated in two sibling objects as no defect", () => {
    expect(duplicateJsonKeys('{ "one": { "n": 1 }, "two": { "n": 2 } }')).toEqual([]);
  });

  it("does not read a string value as a key", () => {
    expect(duplicateJsonKeys('{ "a": "b", "c": "b" }')).toEqual([]);
  });

  it("keeps escapes verbatim, so two keys that differ in source stay distinct", () => {
    expect(duplicateJsonKeys('{ "a\\nb": 1, "anb": 2 }')).toEqual([]);
  });
});

describe("claimedFormat", () => {
  it("names the format an export golden claims", () => {
    expect(claimedFormat("clinic-appointments.ddl.txt")).toBe("ddl");
    expect(claimedFormat("clinic-appointments.openapi.txt")).toBe("openapi");
    expect(claimedFormat("clinic-appointments.avro.txt")).toBe("avro");
  });

  it("claims nothing for the prose goldens", () => {
    // verbalize and validate output has no format to be an instance of;
    // a validator that failed them would make the suite unusable.
    expect(claimedFormat("clinic-appointments.verbalize.txt")).toBeUndefined();
    expect(claimedFormat("clinic-appointments.validate.txt")).toBeUndefined();
  });
});
