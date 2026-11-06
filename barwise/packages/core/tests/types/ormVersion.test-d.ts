/**
 * The 4.0 writer's document type states the version as a literal, a
 * compile-time copy of `CURRENT_ORM_VERSION` no runtime test can read. A
 * bump that missed it would make every written document's type claim the
 * old version (ADR `schema-versioning` decision 2).
 */
import { describe, expectTypeOf, it } from "vitest";
import type { CURRENT_ORM_VERSION } from "../../src/serialization/schemaVersion.js";
import type { OrmYamlDocument40 } from "../../src/serialization/yaml/document.js";

describe("the 4.0 document type's orm_version", () => {
  it("is CURRENT_ORM_VERSION's literal type", () => {
    expectTypeOf<OrmYamlDocument40["orm_version"]>().toEqualTypeOf<typeof CURRENT_ORM_VERSION>();
  });
});
