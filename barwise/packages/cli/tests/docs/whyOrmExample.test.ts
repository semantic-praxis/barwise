/**
 * The README's "Why it is worth learning" section quotes barwise's output for
 * examples/models/order-handover.orm.yaml; this keeps the quote true.
 *
 * Two claims are checked against a fresh derivation, not against a copy:
 *
 * - The blockquoted sentence is what the verbalizer says for the model's
 *   exclusive-or constraint. A wording change in the verbalizer fails here
 *   instead of leaving the README quoting a sentence barwise no longer prints.
 * - The DDL export does not yet emit a CHECK for that rule, in any dialect;
 *   it writes the sentence as a comment above CREATE TABLE sales_order
 *   (barwise-qly). The README states that limitation, so fixing barwise-qly
 *   fails this test on purpose: update the README paragraph and this
 *   assertion in the same commit.
 */

import { isExclusiveOr, OrmYamlSerializer } from "@barwise/core";
import { SQL_DIALECTS } from "@barwise/core/sql";
import { Verbalizer } from "@barwise/core/verbalization";
import { DdlExportFormat } from "@barwise/formats";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const README = "README.md";
const EXAMPLE = "barwise/examples/models/order-handover.orm.yaml";
const readme = readFileSync(`${REPO_ROOT}${README}`, "utf8");
const model = new OrmYamlSerializer().deserialize(readFileSync(`${REPO_ROOT}${EXAMPLE}`, "utf8"));

const xor = model.constraints.find(isExclusiveOr);
const sentence = new Verbalizer()
  .verbalizeModel(model)
  .find((v) => xor !== undefined && v.sourceElementId === xor.id)?.text;

describe("README: Why it is worth learning", () => {
  it("quotes the verbalizer's sentence for the example's exclusive-or", () => {
    expect(sentence).toMatch(/either .* or .* but not both/);
    expect(readme).toContain(`> ${sentence}\n`);
  });

  it("states the DDL export's limitation (barwise-qly)", () => {
    expect(readme).toContain("does not yet generate that `CHECK`");
    expect(readme).toContain("writes the sentence as a comment above `CREATE TABLE sales_order`");
  });

  // The README states the limitation without naming a dialect or an
  // annotation setting, so it has to hold for every dialect the export
  // accepts, with annotations (the default a README reader gets) and
  // without (`--no-annotate`).
  it.each(
    SQL_DIALECTS.flatMap((dialect) => [true, false].map((annotate) => ({ dialect, annotate }))),
  )(
    "the DDL export writes the rule as a comment, not a CHECK: $dialect, annotate $annotate",
    ({ dialect, annotate }) => {
      const { text } = new DdlExportFormat().export(model, { dialect, annotate });
      const sql = text.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");
      expect(sql).not.toMatch(/\bcheck\s*\(/i);
      const comment = text.indexOf(`-- Constraint (not expressible in SQL DDL): ${sentence}\n`);
      const table = text.indexOf("CREATE TABLE sales_order (");
      expect(comment).toBeGreaterThanOrEqual(0);
      expect(table).toBeGreaterThan(comment);
      // Above this table, not trailing a previous one.
      expect(text.slice(comment, table)).not.toMatch(/CREATE TABLE|\);/);
    },
  );
});
