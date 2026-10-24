/**
 * NORMA carries an external preferred identifier both ways
 * (external-preferred-identifier.spec.md, WS2). Before this, the importer
 * read only an internal one and the exporter wrote IsPreferred="false" on
 * every external uniqueness.
 */
import { OrmYamlSerializer, resolvePreferredIdentifier } from "@barwise/core";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NormaExportFormat } from "../src/norma/NormaExportFormat.js";
import { NormaImportFormat } from "../src/norma/NormaImportFormat.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const importNorma = (xml: string) => new NormaImportFormat().parse(xml).model;
const roomXml = () =>
  new NormaExportFormat().export(
    new OrmYamlSerializer().deserialize(
      readFileSync(join(fixtures, "externalIdentifier.orm.yaml"), "utf8"),
    ),
  ).text;

describe("NORMA and an external preferred identifier", () => {
  it("reads NORMA's own PreferredIdentifierFor on an external uniqueness", () => {
    // employeeProject.orm: Employee identified by FirstName and LastName,
    // marked on the constraint only, so this is the IsPreferred path.
    const model = importNorma(readFileSync(join(fixtures, "employeeProject.orm"), "utf8"));
    const employee = model.getObjectTypeByName("Employee")!.id;
    expect(model.preferredIdentifierOf(employee)).toBe("_uc_ext_name");
    const resolved = resolvePreferredIdentifier(model, employee);
    expect(resolved.ok && resolved.at.kind).toBe("external");
  });

  it("writes it, and reads it back from the entity's PreferredIdentifier", () => {
    const xml = roomXml();
    expect(xml).toMatch(/<orm:PreferredIdentifier ref="_c-room-id"\/>/);
    expect(xml).toMatch(/id="_c-room-id"[^>]*IsInternal="false" IsPreferred="true"/);
    // Without the constraint's IsPreferred, so only the entity's reference
    // can name it.
    const back = importNorma(
      xml.replace(/(id="_c-room-id"[^>]*) IsPreferred="true"/, "$1"),
    );
    expect(back.preferredIdentifierOf(back.getObjectTypeByName("Room")!.id)).toBe("_c-room-id");
  });

  it("keeps a duplicate external uniqueness the entity names", () => {
    // The same constraint twice, the second named: dropping the second as a
    // duplicate would drop the identifier with it.
    const xml = roomXml()
      .replace(
        /<orm:PreferredIdentifier ref="_c-room-id"\/>/,
        '<orm:PreferredIdentifier ref="_c-dup"/>',
      )
      .replace(
        /(<orm:UniquenessConstraint id="_c-room-id"[\s\S]*?<\/orm:UniquenessConstraint>)/,
        (m) => m + m.replace('id="_c-room-id"', 'id="_c-dup"').replace(' IsPreferred="true"', ""),
      );
    const back = importNorma(xml);
    expect(back.preferredIdentifierOf(back.getObjectTypeByName("Room")!.id)).toBe("_c-dup");
    expect(back.getConstraint("_c-dup")).toBeDefined();
  });

  it("keeps a duplicate NORMA marks IsPreferred, with no entity reference", () => {
    // The employeeProject shape (marked on the constraint only), duplicated
    // with the flagged copy second.
    const xml = roomXml()
      .replace(/<orm:PreferredIdentifier ref="_c-room-id"\/>/, "")
      .replace(
        /(<orm:UniquenessConstraint id="_c-room-id"[\s\S]*?<\/orm:UniquenessConstraint>)/,
        (m) =>
          m.replace(' IsPreferred="true"', "") + m.replace('id="_c-room-id"', 'id="_c-flagged"'),
      );
    const back = importNorma(xml);
    expect(back.preferredIdentifierOf(back.getObjectTypeByName("Room")!.id)).toBe("_c-flagged");
  });

  it("stores an explicit reference that does not identify, for validation to report", () => {
    // Both roles in one fact type: no common object. An internal reference
    // of the wrong shape was always stored and reported; so is this one.
    const xml = roomXml().replace(
      /(<orm:UniquenessConstraint id="_c-room-id"[\s\S]*?<orm:Role ref=")_r-rhn-nr(")/,
      "$1_r-rib-room$2",
    );
    const back = importNorma(xml.replace(/(id="_c-room-id"[^>]*) IsPreferred="true"/, "$1"));
    const room = back.getObjectTypeByName("Room")!.id;
    expect(back.preferredIdentifierOf(room)).toBe("_c-room-id");
    expect(resolvePreferredIdentifier(back, room).ok).toBe(false);
  });
});
