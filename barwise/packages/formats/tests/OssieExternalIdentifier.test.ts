/**
 * Ossie carries an external preferred identifier both ways
 * (external-preferred-identifier.spec.md, WS2): a stored one is written as
 * identify_by over its component relationships, and identify_by over
 * several relationships reads back as the stored identifier.
 */
import { OrmYamlSerializer, resolvePreferredIdentifier } from "@barwise/core";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { OssieExportFormat } from "../src/ossie/OssieExportFormat.js";
import { OssieImportFormat } from "../src/ossie/OssieImportFormat.js";

const room = () =>
  new OrmYamlSerializer().deserialize(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "fixtures/externalIdentifier.orm.yaml"),
      "utf8",
    ),
  );

describe("Ossie and an external preferred identifier", () => {
  it("writes Room's identifier as identify_by over its two components", () => {
    const text = new OssieExportFormat().export(room()).text;
    const concept = (parse(text).ontology as { concept: string; identify_by?: string[]; }[])
      .find((c) => c.concept === "Room")!;
    expect(concept.identify_by).toEqual(["room_is_in_building", "room_has_roomnr"]);
    expect(text).not.toMatch(/Room: its preferred identifier is not one/);
  });

  it("round-trips it as the stored identifier", () => {
    const text = new OssieExportFormat().export(room()).text;
    const back = new OssieImportFormat().parse(text).model;
    const id = back.getObjectTypeByName("Room")!.id;
    const resolved = resolvePreferredIdentifier(back, id);
    expect(resolved.ok && resolved.at.kind).toBe("external");
  });
});
