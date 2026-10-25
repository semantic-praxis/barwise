/**
 * The existing-model context sent with an incremental extraction hides the
 * fact types an internal identifier spends, which the reference mode
 * implies, and keeps an external scheme's: its components are not what the
 * reference mode says, so hiding them would hide the scheme
 * (external-preferred-identifier.spec.md).
 */
import { OrmYamlSerializer } from "@barwise/core";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildExistingModelContext } from "../src/ModelContext.js";

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/externalIdentifier.orm.yaml",
);

describe("buildExistingModelContext", () => {
  it("keeps an external identifier's component fact types", () => {
    const text = buildExistingModelContext(
      new OrmYamlSerializer().deserialize(readFileSync(fixture, "utf8")),
    );
    expect(text).toContain("Room is in Building");
    expect(text).toContain("Room has RoomNr");
  });
});
