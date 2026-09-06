import { CURRENT_ORM_VERSION } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { PROJECT_SCAFFOLD } from "../../src/commands/projectScaffold.js";

describe("PROJECT_SCAFFOLD", () => {
  it("claims the orm_version the serializer writes today (barwise-5t9.14)", () => {
    // The scaffold carried a literal "1.0" through the bump to 1.1. A
    // new file migrates on load either way, but a scaffold that says
    // an older version than the tool that wrote it is a claim about
    // the document that is false the moment it is created.
    const doc = parse(PROJECT_SCAFFOLD) as { orm_version: string; model: { name: string; }; };
    expect(doc.orm_version).toBe(CURRENT_ORM_VERSION);
    expect(doc.model.name).toBe("New Domain Model");
  });
});
