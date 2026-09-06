/**
 * Tests for the ReportBuilder's public counting API.
 *
 * `info`/`warning`/`gap`/`build` are already exercised indirectly by
 * every test that imports a dbt project (DbtProjectImporter,
 * sqlPatterns). `countBySeverity` is a separate public method on the
 * exported `ReportBuilder` with no caller of its own yet, so nothing
 * else in the suite exercises it.
 */
import { describe, expect, it } from "vitest";
import { ReportBuilder } from "../src/DbtImportReport.js";

describe("ReportBuilder.countBySeverity", () => {
  it("counts entries per severity across categories", () => {
    const report = new ReportBuilder();
    report.info("identifier", "customers", "Used customer_id as primary key.");
    report.info("data_type", "customers", "Inferred TEXT for email.", "email");
    report.warning("relationship", "orders", "Inferred FK from naming convention.", "customer_id");
    report.gap("description", "orders", "No description provided.");
    report.gap("model_scope", "orders", "Could not classify staging vs. mart.");

    expect(report.countBySeverity("info")).toBe(2);
    expect(report.countBySeverity("warning")).toBe(1);
    expect(report.countBySeverity("gap")).toBe(2);
  });

  it("returns zero for a severity with no entries", () => {
    const report = new ReportBuilder();
    report.info("identifier", "customers", "Used customer_id as primary key.");

    expect(report.countBySeverity("gap")).toBe(0);
  });

  it("reflects entries added after a build() snapshot was taken", () => {
    const report = new ReportBuilder();
    const first = report.build();
    expect(first.entries).toHaveLength(0);

    report.gap("macro", "orders", "Unrecognized custom test.");

    expect(report.countBySeverity("gap")).toBe(1);
    expect(first.entries).toHaveLength(0);
  });
});
