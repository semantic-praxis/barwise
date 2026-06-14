/**
 * dbt dialect detector.
 *
 * Reads dbt project configuration to determine the SQL dialect.
 * The dialect is needed for the Calcite cascade parser to apply
 * correct lexer and conformance settings.
 *
 * Detection strategy (priority order):
 * 1. Explicit dialect option from the user
 * 2. Target adapter type supplied by the caller (the tool layer reads
 *    DBT_TARGET_TYPE / DBT_ADAPTER from the environment and passes it in)
 * 3. dbt_project.yml profile -> profiles.yml adapter type
 * 4. Installed dbt packages (dbt-snowflake, dbt-bigquery, etc.)
 * 5. Fall back to "ansi"
 *
 * This module stays deterministic: it never reads `process.env`. The
 * environment-derived values are passed in as options by the caller,
 * keeping ambient state at the tool boundary.
 */

import type { SqlDialect } from "@barwise/core";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Map dbt adapter names to Calcite SQL dialects.
 */
const ADAPTER_TO_DIALECT: Record<string, SqlDialect> = {
  snowflake: "snowflake",
  bigquery: "bigquery",
  postgres: "postgres",
  redshift: "redshift",
  mysql: "mysql",
  databricks: "databricks",
  spark: "databricks",
};

/**
 * Explicit inputs for dialect detection, supplied by the caller in place
 * of ambient state. The tool layer (cli/mcp) reads the environment and
 * populates these.
 */
export interface DbtDialectOptions {
  /** User-provided dialect override (highest priority). */
  readonly dialect?: SqlDialect;
  /**
   * dbt target adapter type, e.g. the value of the `DBT_TARGET_TYPE` or
   * `DBT_ADAPTER` environment variable, read by the caller.
   */
  readonly targetType?: string;
  /**
   * Home directory used to locate `~/.dbt/profiles.yml`, e.g. the value
   * of `HOME` / `USERPROFILE`, read by the caller. When omitted, only the
   * project directory is searched for `profiles.yml`.
   */
  readonly homeDir?: string;
}

/**
 * Detect the SQL dialect for a dbt project.
 *
 * @param projectDir - Path to the dbt project root
 * @param options - Explicit detection inputs (dialect override and
 *   environment-derived values supplied by the caller)
 * @returns The detected SQL dialect
 */
export function detectDbtDialect(
  projectDir: string,
  options?: DbtDialectOptions,
): SqlDialect {
  // 1. Explicit override
  if (options?.dialect) {
    return options.dialect;
  }

  // 2. Caller-supplied target adapter type (from the environment)
  const targetDialect = dialectFromTargetType(options?.targetType);
  if (targetDialect) {
    return targetDialect;
  }

  // 3. dbt_project.yml -> profiles.yml
  const profileDialect = detectFromProfiles(projectDir, options?.homeDir);
  if (profileDialect) {
    return profileDialect;
  }

  // 4. Installed packages
  const packageDialect = detectFromPackages(projectDir);
  if (packageDialect) {
    return packageDialect;
  }

  // 5. Fall back to ANSI
  return "ansi";
}

/**
 * Map a caller-supplied target adapter type to a dialect.
 */
function dialectFromTargetType(targetType?: string): SqlDialect | undefined {
  if (!targetType) {
    return undefined;
  }
  return ADAPTER_TO_DIALECT[targetType.toLowerCase().trim()];
}

/**
 * Detect dialect from dbt_project.yml + profiles.yml.
 */
function detectFromProfiles(
  projectDir: string,
  homeDir?: string,
): SqlDialect | undefined {
  // Read dbt_project.yml to get the profile name
  const projectPath = join(projectDir, "dbt_project.yml");
  if (!existsSync(projectPath)) {
    return undefined;
  }

  let projectContent: string;
  try {
    projectContent = readFileSync(projectPath, "utf-8");
  } catch {
    return undefined;
  }

  // Extract profile name (simple regex, avoids YAML dependency here)
  const profileMatch = /^profile:\s*['"]?(\w[\w-]*)['"]?/m.exec(projectContent);
  if (!profileMatch) {
    return undefined;
  }

  // Look for profiles.yml in standard locations
  const profilePaths = [join(projectDir, "profiles.yml")];
  if (homeDir) {
    profilePaths.push(join(homeDir, ".dbt", "profiles.yml"));
  }

  for (const profilePath of profilePaths) {
    if (!existsSync(profilePath)) continue;

    let profileContent: string;
    try {
      profileContent = readFileSync(profilePath, "utf-8");
    } catch {
      continue;
    }

    // Look for "type: <adapter>" under the profile
    const typeMatch = /\btype:\s*['"]?(\w+)['"]?/m.exec(profileContent);
    if (typeMatch) {
      const adapter = typeMatch[1]!.toLowerCase();
      const dialect = ADAPTER_TO_DIALECT[adapter];
      if (dialect) return dialect;
    }
  }

  return undefined;
}

/**
 * Detect dialect from installed dbt packages.
 *
 * Checks packages.yml and requirements.txt for dbt adapter packages.
 */
function detectFromPackages(projectDir: string): SqlDialect | undefined {
  // Check requirements.txt for pip-installed adapters
  const reqPath = join(projectDir, "requirements.txt");
  if (existsSync(reqPath)) {
    try {
      const content = readFileSync(reqPath, "utf-8");
      for (const [adapter, dialect] of Object.entries(ADAPTER_TO_DIALECT)) {
        if (content.includes(`dbt-${adapter}`)) {
          return dialect;
        }
      }
    } catch {
      // Ignore read errors
    }
  }

  return undefined;
}
