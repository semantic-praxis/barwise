/**
 * The acceptance grader maps an import's names back through the skin
 * that renamed them (docs/specs/trial-skin-name-mapping.spec.md,
 * barwise-d60). Synthetic models, so each case shows one rule.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse, stringify } from "yaml";
import { gradedCandidate, renameImported, skinRenames } from "../lib/skinNames.mjs";

const kernel = (...ots) => ({
  model: { object_types: ots.map(([name, kind = "entity"]) => ({ name, kind })) },
});
const imported = (...names) => ({
  model: { object_types: names.map((name) => ({ id: name, name, kind: "entity" })) },
});
const renames = (k, skin, i) => Object.fromEntries(skinRenames(k, skin, i));

test("an abbreviation dictionary is applied forward: SGBSTDN is Student", () => {
  const skin = {
    naming: { table_case: "upper", abbreviate: true, abbreviations: { Student: "SGBSTDN" } },
  };
  assert.deepEqual(
    renames(kernel(["Student"], ["GraduateStudent"]), skin, imported("Sgbstdn", "GraduateSgbstdn")),
    { Sgbstdn: "Student", GraduateSgbstdn: "GraduateStudent" },
  );
});

test("a table prefix is part of the spelling: PcPolicy is Policy", () => {
  const skin = { naming: { table_case: "lower", table_prefix: "pc_" } };
  assert.deepEqual(renames(kernel(["Policy"]), skin, imported("PcPolicy")), { PcPolicy: "Policy" });
});

test("a truncated name maps, though no rule could expand it back", () => {
  const skin = { naming: { table_case: "lower", max_identifier: 8 } };
  assert.deepEqual(
    renames(kernel(["Household"]), skin, imported("Househol")),
    { Househol: "Household" },
  );
});

test("a value type is spelled as its column, not as a table", () => {
  // The prefix belongs to tables only: spelled as a table, StudentNumber
  // would be pc_sgbstdn_number and match nothing.
  const skin = {
    naming: {
      table_case: "lower",
      column_case: "upper",
      table_prefix: "pc_",
      abbreviate: true,
      abbreviations: { Student: "SGBSTDN" },
    },
  };
  assert.deepEqual(
    renames(kernel(["StudentNumber", "value"]), skin, imported("SgbstdnNumber")),
    { SgbstdnNumber: "StudentNumber" },
  );
});

test("a spelling two kernel concepts share maps neither", () => {
  // Truncated to four characters, Student and Studio are both STUD; the
  // import's Stud names one of them, and guessing which grades a concept
  // the import never named.
  const skin = { naming: { table_case: "lower", max_identifier: 4 } };
  assert.deepEqual(renames(kernel(["Student"], ["Studio"]), skin, imported("Stud")), {});
});

test("the renamed copy keeps the import's own name as an alias", () => {
  const doc = imported("Sgbstdn");
  const out = renameImported(doc, new Map([["Sgbstdn", "Student"]]));
  assert.deepEqual(out.model.object_types[0], {
    id: "Sgbstdn",
    name: "Student",
    kind: "entity",
    aliases: ["Sgbstdn"],
  });
  assert.equal(doc.model.object_types[0].name, "Sgbstdn", "the import itself is untouched");
});

test("a name the artifact declares twice maps nothing: the import kept only one of them", () => {
  const skin = {
    naming: { table_case: "upper", abbreviate: true, abbreviations: { Person: "SPRIDEN" } },
  };
  assert.deepEqual(
    renames(kernel(["Person"]), skin, imported("Spriden")),
    { Spriden: "Person" },
  );
  assert.equal(
    skinRenames(kernel(["Person"]), skin, imported("Spriden"), { declaredTwice: ["SPRIDEN"] })
      .size,
    0,
  );
});

/**
 * A customer on disk: a kernel, a skin, an imported model and the
 * artifact's manifest, so gradedCandidate is driven through the same
 * files sprint6Surfaces hands it.
 */
function customerOnDisk({ manifestTables = ["SGBSTDN"] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "skin-graded-"));
  const kernelPath = join(dir, "kernel.orm.yaml");
  writeFileSync(kernelPath, stringify(kernel(["Student"])));
  writeFileSync(
    join(dir, "skin.yaml"),
    stringify({
      naming: { table_case: "upper", abbreviate: true, abbreviations: { Student: "SGBSTDN" } },
    }),
  );
  const importedPath = join(dir, "sis-ddl.imported.orm.yaml");
  writeFileSync(importedPath, stringify(imported("Sgbstdn")));
  writeFileSync(
    join(dir, "sis-ddl.manifest.json"),
    JSON.stringify({ tables: manifestTables.map((name) => ({ name })) }),
  );
  const customer = { dir, kernelPath, artifacts: [{ id: "sis-ddl", skin: "skin.yaml" }] };
  return { customer, dir, importedPath };
}

test("gradedCandidate: a skinned DDL import is graded through a renamed copy beside it", () => {
  const { customer, dir, importedPath } = customerOnDisk();
  const got = gradedCandidate(customer, dir, "sis-ddl", importedPath, "ddl");
  assert.deepEqual(got, { path: join(dir, "sis-ddl.graded.orm.yaml"), mapped: 1 });
  const graded = parse(readFileSync(got.path, "utf8"));
  assert.deepEqual(graded.model.object_types[0].name, "Student");
  assert.equal(parse(readFileSync(importedPath, "utf8")).model.object_types[0].name, "Sgbstdn");
});

test("gradedCandidate: anything but a skinned DDL import is graded as it stands", () => {
  const { customer, dir, importedPath } = customerOnDisk();
  for (const [label, kind] of [["sis-ddl", "dbt"], ["kernel", "ddl"]]) {
    assert.deepEqual(gradedCandidate(customer, dir, label, importedPath, kind), {
      path: importedPath,
      mapped: 0,
    });
  }
});

test("gradedCandidate: a table the manifest lists twice is not mapped", () => {
  const { customer, dir, importedPath } = customerOnDisk({
    manifestTables: ["SGBSTDN", "SGBSTDN"],
  });
  assert.deepEqual(gradedCandidate(customer, dir, "sis-ddl", importedPath, "ddl"), {
    path: importedPath,
    mapped: 0,
  });
});
