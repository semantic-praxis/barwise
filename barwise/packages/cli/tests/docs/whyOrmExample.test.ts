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
import { MAX_SAMPLES, MIN_SAMPLES } from "@barwise/llm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const README = "README.md";
const EXAMPLE = "barwise/examples/models/order-handover.orm.yaml";
const SHOP_DIR = "barwise/examples/getting-started/";
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

  // The README tells the reader to run this command to see the sentence, so
  // the command has to print it, not just the Verbalizer underneath it.
  it("prints that sentence from the command the README gives", async () => {
    // Derived from EXAMPLE, so moving the file cannot leave the README's
    // command pointing at the old path while this test loads the new one.
    expect(EXAMPLE.startsWith("barwise/")).toBe(true);
    const fromBarwise = EXAMPLE.slice("barwise/".length);
    expect(readme).toContain(`Run \`barwise verbalize ${fromBarwise}\` from \`barwise/\``);
    const result = await runCli(["verbalize", `${REPO_ROOT}${EXAMPLE}`]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.split("\n").map((line) => line.trim())).toContain(sentence);
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

// The Quick start quotes barwise output and a CLI limit too; the same rule
// holds there: what the README says barwise prints, barwise prints.
describe("README: Quick start", () => {
  it("quotes a sentence step 3's command really prints for the sample model", async () => {
    const quoted = "Each SalesOrder is placed by at least one Customer";
    expect(readme).toContain(`(${SHOP_DIR})`);
    expect(readme).toContain("`barwise verbalize shop.orm.yaml --counterexamples`");
    expect(readme).toContain(`("${quoted}")`);
    const result = await runCli([
      "verbalize",
      `${REPO_ROOT}${SHOP_DIR}shop.orm.yaml`,
      "--counterexamples",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.split("\n").map((line) => line.trim())).toContain(`${quoted}.`);
  });

  // MIN_SAMPLES and MAX_SAMPLES bound the sampling path the bullet
  // describes; --samples 1 is accepted too, as the plain single extraction.
  it("states the range of the multi-sample path (MIN_SAMPLES to MAX_SAMPLES)", () => {
    const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
    expect(readme).toContain(`${words[MIN_SAMPLES]} to ${words[MAX_SAMPLES]} times`);
  });
});
