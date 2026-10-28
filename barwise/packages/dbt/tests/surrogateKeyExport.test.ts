/**
 * dbt export with generated keys (surrogate-key-export.spec.md,
 * barwise-td6): the model SQL computes each generated column from the
 * source columns it hashes, the source having no such column, and the
 * natural key keeps its combination test.
 */
import { OrmYamlSerializer } from "@barwise/core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { DbtExportFormat } from "../src/DbtExportFormat.js";

const MODEL = resolve(
  import.meta.dirname,
  "../../formats/tests/fixtures/externalIdentifier.orm.yaml",
);

describe("a dbt export with generated keys", () => {
  const model = new OrmYamlSerializer().deserialize(readFileSync(MODEL, "utf8"));
  const { files } = new DbtExportFormat().export(model, { surrogateKeys: true, annotate: false });
  const file = (suffix: string) => files!.find((f) => f.name.endsWith(suffix))!.content;

  it("computes the generated key in the model SQL", () => {
    expect(file("/room.sql")).toContain(
      "{{ dbt_utils.generate_surrogate_key(['building_code', 'room_nr']) }} AS room_key",
    );
  });

  it("hashes an optional reference only when every column it hashes is present", () => {
    // Rooms, plus a booking that may name no room.
    const withBooking = new OrmYamlSerializer().deserialize(readFileSync(MODEL, "utf8"));
    const booking = withBooking.addObjectType({
      name: "Booking",
      kind: "entity",
      referenceMode: "booking_id",
    });
    const roomId = withBooking.getObjectTypeByName("Room")!.id;
    withBooking.addFactType({
      name: "Booking is for Room",
      roles: [
        { id: "r-bfr-booking", name: "is for", playerId: booking.id },
        { id: "r-bfr-room", name: "has", playerId: roomId },
      ],
      readings: ["{0} is for {1}"],
      constraints: [{ type: "internal_uniqueness", roleIds: ["r-bfr-booking"] }],
    });
    const { files: out } = new DbtExportFormat().export(withBooking, {
      surrogateKeys: true,
      annotate: false,
    });
    const sql = out!.find((f) => f.name.endsWith("/booking.sql"))!.content;
    expect(sql).toContain(
      "CASE WHEN building_code IS NULL OR room_nr IS NULL THEN NULL ELSE "
        + "{{ dbt_utils.generate_surrogate_key(['building_code', 'room_nr']) }} END AS room_key",
    );
  });

  it("keys the model on it, and keeps the natural key as a combination test", () => {
    const doc = parse(file("schema.yml")) as {
      models: {
        name: string;
        data_tests?: unknown[];
        tests?: unknown[];
        columns: { name: string; data_tests?: unknown[]; tests?: unknown[]; }[];
      }[];
    };
    const room = doc.models.find((m) => m.name === "room")!;
    const key = room.columns.find((c) => c.name === "room_key")!;
    expect(JSON.stringify(key.data_tests ?? key.tests)).toContain("unique");
    const tests = JSON.stringify(room.data_tests ?? room.tests ?? []);
    expect(tests).toContain("unique_combination_of_columns");
    expect(tests).toMatch(/building_code[^\]]*room_nr|room_nr[^\]]*building_code/);
  });
});
