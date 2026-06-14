/**
 * Tests for the dbt YAML annotator.
 *
 * Verifies that TODO/NOTE comments are injected at the correct
 * positions in dbt schema YAML files based on import report entries.
 */
import { describe, expect, it } from "vitest";
import type { DbtImportReport } from "../src/DbtImportReport.js";
import type { ReportEntry } from "../src/DbtImportReport.js";
import { annotateDbtYaml } from "../src/DbtYamlAnnotator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReport(...entries: ReportEntry[]): DbtImportReport {
  return { entries };
}

function gap(
  modelName: string,
  message: string,
  columnName?: string,
): ReportEntry {
  return {
    severity: "gap",
    category: "data_type",
    modelName,
    message,
    columnName,
  };
}

function warning(
  modelName: string,
  message: string,
  columnName?: string,
): ReportEntry {
  return {
    severity: "warning",
    category: "macro",
    modelName,
    message,
    columnName,
  };
}

function info(
  modelName: string,
  message: string,
  columnName?: string,
): ReportEntry {
  return {
    severity: "info",
    category: "data_type",
    modelName,
    message,
    columnName,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DbtYamlAnnotator", () => {
  const SIMPLE_YAML = `version: 2

models:
  - name: stg_orders
    description: Order staging model.
    columns:
      - name: order_id
        data_tests:
          - unique
          - not_null
      - name: status
        description: Current order status.
      - name: total
        data_type: "decimal(10,2)"
`;

  describe("column-level annotations", () => {
    it("injects a TODO comment after a column with a gap", () => {
      const report = makeReport(
        gap(
          "stg_orders",
          'No data_type for column "status" in model or source definitions.',
          "status",
        ),
      );
      const result = annotateDbtYaml(SIMPLE_YAML, report);

      const lines = result.split("\n");
      const statusIdx = lines.findIndex((l) => l.includes("- name: status"));
      expect(statusIdx).toBeGreaterThan(-1);
      expect(lines[statusIdx + 1]).toContain("# TODO(barwise):");
      expect(lines[statusIdx + 1]).toContain("No data_type");
    });

    it("injects a TODO comment for a warning on a column", () => {
      const report = makeReport(
        warning("stg_orders", 'Custom test "foo" needs review.', "total"),
      );
      const result = annotateDbtYaml(SIMPLE_YAML, report);

      const lines = result.split("\n");
      const totalIdx = lines.findIndex((l) => l.includes("- name: total"));
      expect(totalIdx).toBeGreaterThan(-1);
      expect(lines[totalIdx + 1]).toContain("# TODO(barwise):");
      expect(lines[totalIdx + 1]).toContain("Custom test");
    });

    it("does not inject info comments by default", () => {
      const report = makeReport(
        info("stg_orders", 'Data type "date" resolved.', "status"),
      );
      const result = annotateDbtYaml(SIMPLE_YAML, report);
      expect(result).not.toContain("# NOTE(barwise):");
    });

    it("injects NOTE comments for info entries when includeInfoNotes is true", () => {
      const report = makeReport(
        info("stg_orders", "Resolved from source: varchar(20).", "status"),
      );
      const result = annotateDbtYaml(SIMPLE_YAML, report, {
        includeInfoNotes: true,
      });

      const lines = result.split("\n");
      const statusIdx = lines.findIndex((l) => l.includes("- name: status"));
      expect(statusIdx).toBeGreaterThan(-1);
      expect(lines[statusIdx + 1]).toContain("# NOTE(barwise):");
      expect(lines[statusIdx + 1]).toContain("Resolved from source");
    });

    it("injects multiple comments on the same column", () => {
      const report = makeReport(
        gap("stg_orders", "No data_type.", "status"),
        warning("stg_orders", "Description was inferred.", "status"),
      );
      const result = annotateDbtYaml(SIMPLE_YAML, report);

      const lines = result.split("\n");
      const statusIdx = lines.findIndex((l) => l.includes("- name: status"));
      expect(lines[statusIdx + 1]).toContain("# TODO(barwise): No data_type.");
      expect(lines[statusIdx + 2]).toContain(
        "# TODO(barwise): Description was inferred.",
      );
    });
  });

  describe("model-level annotations", () => {
    it("injects a TODO comment after a model name for model-level entries", () => {
      const report = makeReport(
        warning(
          "stg_orders",
          'Model-level custom test "expression_is_true" -- manual review needed.',
        ),
      );
      const result = annotateDbtYaml(SIMPLE_YAML, report);

      const lines = result.split("\n");
      const modelIdx = lines.findIndex((l) => l.includes("- name: stg_orders"));
      expect(modelIdx).toBeGreaterThan(-1);
      expect(lines[modelIdx + 1]).toContain("# TODO(barwise):");
      expect(lines[modelIdx + 1]).toContain("expression_is_true");
    });
  });

  describe("multi-model YAML", () => {
    const MULTI_YAML = `version: 2

models:
  - name: stg_customers
    columns:
      - name: customer_id
        data_tests:
          - unique
          - not_null
      - name: customer_name
  - name: stg_orders
    columns:
      - name: order_id
        data_tests:
          - unique
          - not_null
      - name: status
`;

    it("annotates columns in the correct model context", () => {
      const report = makeReport(
        gap("stg_customers", "Missing type.", "customer_name"),
        gap("stg_orders", "Missing type.", "status"),
      );
      const result = annotateDbtYaml(MULTI_YAML, report);

      const lines = result.split("\n");

      // customer_name should get annotated in stg_customers context.
      const custNameIdx = lines.findIndex((l) => l.includes("- name: customer_name"));
      expect(lines[custNameIdx + 1]).toContain("# TODO(barwise):");

      // status should get annotated in stg_orders context.
      const statusIdx = lines.findIndex((l) => l.includes("- name: status"));
      expect(lines[statusIdx + 1]).toContain("# TODO(barwise):");
    });

    it("does not annotate columns in the wrong model", () => {
      // Gap is for stg_orders.status, not stg_customers.status
      const report = makeReport(
        gap("stg_orders", "Missing type.", "status"),
      );
      const result = annotateDbtYaml(MULTI_YAML, report);

      // customer_name should NOT have a comment.
      const lines = result.split("\n");
      const custNameIdx = lines.findIndex((l) => l.includes("- name: customer_name"));
      expect(lines[custNameIdx + 1]).not.toContain("# TODO(barwise):");
    });
  });

  describe("filtering", () => {
    it("filters by category when specified", () => {
      const report = makeReport(
        gap("stg_orders", "Missing data_type.", "status"),
        warning("stg_orders", "Macro test needs review."),
      );
      const result = annotateDbtYaml(SIMPLE_YAML, report, {
        categories: ["data_type"],
      });

      expect(result).toContain("Missing data_type");
      expect(result).not.toContain("Macro test");
    });
  });

  describe("edge cases", () => {
    it("returns unchanged YAML when report has no matching entries", () => {
      const report = makeReport(
        info("stg_orders", "All good.", "status"),
      );
      // Info excluded by default.
      const result = annotateDbtYaml(SIMPLE_YAML, report);
      expect(result).toBe(SIMPLE_YAML);
    });

    it("returns unchanged YAML for an empty report", () => {
      const report = makeReport();
      const result = annotateDbtYaml(SIMPLE_YAML, report);
      expect(result).toBe(SIMPLE_YAML);
    });

    it("preserves original YAML structure", () => {
      const report = makeReport(
        gap("stg_orders", "Missing type.", "status"),
      );
      const result = annotateDbtYaml(SIMPLE_YAML, report);

      // Removing TODO lines should give back the original.
      const cleaned = result
        .split("\n")
        .filter((l) => !l.includes("# TODO(barwise):"))
        .join("\n");
      expect(cleaned).toBe(SIMPLE_YAML);
    });

    it("is idempotent -- re-annotating produces the same result", () => {
      const report = makeReport(
        gap("stg_orders", "Missing type.", "status"),
        warning("stg_orders", "Macro test needs review."),
        info("stg_orders", "Resolved from source.", "order_id"),
      );
      const opts = { includeInfoNotes: true };

      const first = annotateDbtYaml(SIMPLE_YAML, report, opts);
      const second = annotateDbtYaml(first, report, opts);

      expect(second).toBe(first);
    });

    it("strips stale annotations when report changes", () => {
      const reportV1 = makeReport(
        gap("stg_orders", "Missing type.", "status"),
        gap("stg_orders", "Missing type.", "total"),
      );
      const annotated = annotateDbtYaml(SIMPLE_YAML, reportV1);
      expect(annotated).toContain("status");
      expect(annotated).toContain("total");

      // V2: only the status gap remains.
      const reportV2 = makeReport(
        gap("stg_orders", "Missing type.", "status"),
      );
      const reannotated = annotateDbtYaml(annotated, reportV2);

      // The "total" TODO should be gone -- only one TODO line remains.
      const todoLines = reannotated
        .split("\n")
        .filter((l) => l.includes("# TODO(barwise):"));
      expect(todoLines).toHaveLength(1);

      // Verify the remaining TODO is positioned after "- name: status".
      const lines = reannotated.split("\n");
      const statusIdx = lines.findIndex((l) => l.includes("- name: status"));
      expect(lines[statusIdx + 1]).toContain("# TODO(barwise):");
      const totalIdx = lines.findIndex((l) => l.includes("- name: total"));
      expect(lines[totalIdx + 1]).not.toContain("# TODO(barwise):");
    });

    it("strips all annotations when given an empty report", () => {
      const report = makeReport(
        gap("stg_orders", "Missing type.", "status"),
      );
      const annotated = annotateDbtYaml(SIMPLE_YAML, report);
      expect(annotated).toContain("# TODO(barwise):");

      const stripped = annotateDbtYaml(annotated, makeReport());
      expect(stripped).not.toContain("# TODO(barwise):");
      expect(stripped).toBe(SIMPLE_YAML);
    });
  });
});
