/**
 * The stderr report of what an export's format could not express, shared
 * by `barwise export` and `barwise schema` so neither command imports
 * the other (export-constraint-specs.spec.md, schema-ddl-routing.spec.md).
 */
import type { ExportFormatAdapter } from "@barwise/core";
import { formatConstraintReport } from "@barwise/formats";

/**
 * Name on stderr the constraints the format reported it could not
 * express. Beside the artifact, not in it: stdout may be a pipeline's
 * input.
 */
export function reportConstraintSpecs(
  result: ReturnType<ExportFormatAdapter["export"]>,
  format: string,
  domain?: string,
): void {
  const report = formatConstraintReport(result.constraintSpecs, format, domain ? { domain } : {});
  if (report) process.stderr.write(report + "\n");
}
