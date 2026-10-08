/**
 * The acceptance grader maps an import's names back through the skin
 * that renamed them (docs/specs/trial-skin-name-mapping.spec.md,
 * barwise-d60). Synthetic models, so each case shows one rule.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { renameImported, skinRenames } from "../lib/skinNames.mjs";

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
