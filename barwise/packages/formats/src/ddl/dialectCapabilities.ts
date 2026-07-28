/**
 * Per-dialect constraint capability profiles for DDL export
 * (sql-dialect-capability spec, WS2).
 *
 * The conceptual model is dialect-free; expressibility is a property
 * of the target engine, and the export adapter owns that judgment
 * explicitly. Each profile routes a constraint category one of three
 * ways:
 *
 *   - "native": the engine parses AND enforces the clause.
 *   - "informational": the engine accepts the clause but does not
 *     enforce it (rendered with the dialect's marker, e.g.
 *     `NOT ENFORCED`, or a trailing comment when the dialect treats
 *     the clause as informational implicitly).
 *   - "absent": the engine has no such clause. The constraint degrades
 *     to a SQL comment plus a ConstraintSpec in the export result, so
 *     the loss is visible output, never silent dropping.
 *
 * This is a declarative table rather than a derivation from sqlglot
 * dialect metadata: explicit over implicit, and the judgment must not
 * be coupled to an optional dependency. NOT NULL is enforced natively
 * by every supported dialect and is not routed.
 *
 * The profile decides constraints only; type rendering is untouched
 * (the spec defers dialect-specific types until there is demand).
 */

import type { SqlDialect } from "@barwise/core/sql";

/** How a dialect carries one constraint category. */
export type ConstraintChannel = "native" | "informational" | "absent";

/** Constraint capability profile for one SQL dialect. */
export interface DialectCapabilityProfile {
  /** PRIMARY KEY clauses. */
  readonly primaryKey: ConstraintChannel;
  /** FOREIGN KEY ... REFERENCES clauses. */
  readonly foreignKey: ConstraintChannel;
  /** Table-level UNIQUE clauses (secondary uniqueness). */
  readonly unique: ConstraintChannel;
  /** CHECK clauses (value constraints and value comparisons). */
  readonly check: ConstraintChannel;
  /**
   * SQL appended to an informational clause (e.g. " NOT ENFORCED").
   * Empty when the dialect accepts the plain clause and simply never
   * enforces it; the exporter then marks the line with a comment.
   */
  readonly informationalSuffix: string;
}

/**
 * The capability table. Sources: engine documentation as of 2026 --
 * Postgres and MySQL (8.0.16+) enforce all four; Snowflake and
 * Redshift keep PK/FK/UNIQUE as informational metadata and have no
 * CHECK; BigQuery supports PK/FK only as `NOT ENFORCED` and has no
 * UNIQUE or CHECK; Databricks (Delta) enforces CHECK and NOT NULL but
 * keeps PK/FK informational.
 */
export const DIALECT_PROFILES: Record<SqlDialect, DialectCapabilityProfile> = {
  ansi: {
    primaryKey: "native",
    foreignKey: "native",
    unique: "native",
    check: "native",
    informationalSuffix: "",
  },
  postgres: {
    primaryKey: "native",
    foreignKey: "native",
    unique: "native",
    check: "native",
    informationalSuffix: "",
  },
  mysql: {
    primaryKey: "native",
    foreignKey: "native",
    unique: "native",
    check: "native",
    informationalSuffix: "",
  },
  snowflake: {
    primaryKey: "informational",
    foreignKey: "informational",
    unique: "informational",
    check: "absent",
    informationalSuffix: " NOT ENFORCED",
  },
  bigquery: {
    primaryKey: "informational",
    foreignKey: "informational",
    unique: "absent",
    check: "absent",
    informationalSuffix: " NOT ENFORCED",
  },
  redshift: {
    primaryKey: "informational",
    foreignKey: "informational",
    unique: "informational",
    check: "absent",
    // Redshift accepts the plain clause and never enforces it; there
    // is no NOT ENFORCED syntax, so the marker is a comment.
    informationalSuffix: "",
  },
  databricks: {
    primaryKey: "informational",
    foreignKey: "informational",
    unique: "absent",
    check: "native",
    informationalSuffix: " NOT ENFORCED",
  },
};

/**
 * Resolve a dialect name to its profile.
 *
 * @throws on an unknown dialect, listing the supported names.
 */
export function resolveDialectProfile(dialect: string): DialectCapabilityProfile {
  const profile = (DIALECT_PROFILES as Record<string, DialectCapabilityProfile>)[dialect];
  if (!profile) {
    const known = Object.keys(DIALECT_PROFILES).join(", ");
    throw new Error(`Unknown SQL dialect "${dialect}". Supported dialects: ${known}.`);
  }
  return profile;
}
