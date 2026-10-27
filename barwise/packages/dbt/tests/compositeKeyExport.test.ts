/**
 * A key over several columns is tested on the model when the dbt exporter
 * writes it, and the dbt importer reads that test back as the key
 * (dbt-composite-key-tests.spec.md, barwise-lqj). Before, the exporter
 * tested only a single-column key, so a many-to-many table re-imported as
 * a model with no identifier.
 */
import { describe, expect, it } from "vitest";
import { DbtExportFormat } from "../src/DbtExportFormat.js";
import { importDbtProject } from "../src/DbtProjectImporter.js";
import { ModelBuilder } from "./helpers/ModelBuilder.js";

function enrolls() {
  return new ModelBuilder("School")
    .withEntityType("Student", { referenceMode: "student_id" })
    .withEntityType("Course", { referenceMode: "course_id" })
    .withBinaryFactType("Student enrolls in Course", {
      role1: { player: "Student", name: "enrolls in" },
      role2: { player: "Course", name: "has enrolled" },
    })
    .build();
}

function exportedSchema(): string {
  const files = new DbtExportFormat().export(enrolls()).files ?? [];
  return files.find((f) => f.name.endsWith("schema.yml"))!.content;
}

describe("a composite key on dbt export", () => {
  it("is written as a model-level unique_combination_of_columns test", () => {
    expect(exportedSchema()).toContain("dbt_utils.unique_combination_of_columns");
  });

  it("reads back as the fact type it keys, spanning both roles", () => {
    const { model, report } = importDbtProject([exportedSchema()]);
    expect(JSON.stringify(report)).not.toContain("Cannot determine primary identifier");
    const enrolment = model.factTypes.find((ft) =>
      ft.roles.map((r) => model.getObjectType(r.playerId)?.name).sort().join(",")
        === "Course,Student"
    )!;
    expect(
      enrolment.internalConstraints.filter((c) => c.type === "internal_uniqueness")
        .map((c) => c.roleIds.length),
    ).toEqual([2]);
  });
});
