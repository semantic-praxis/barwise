/**
 * The one walk over a dbt project tree.
 *
 * "Which directories are never dbt source" is a single decision: dbt's
 * own outputs (target/), installed packages (dbt_packages/), logs/,
 * and the VCS/node artifacts. The SQL and YAML walks each stating it
 * separately is how the SQL walk drifted to a shorter list and mined
 * compiled SQL out of target/ as if it were source (barwise-864).
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".git", "target", "dbt_packages", "logs"]);

/**
 * Recursively collect files under `dir` whose basename satisfies
 * `matches`, never descending into the non-source directories above.
 * Unreadable directories and entries are skipped silently: a project
 * tree may contain sockets, dangling symlinks, or permission holes,
 * and discovery should degrade rather than fail.
 */
export function findProjectFiles(dir: string, matches: (name: string) => boolean): string[] {
  const results: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);

    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry)) {
        continue;
      }
      results.push(...findProjectFiles(fullPath, matches));
    } else if (matches(entry)) {
      results.push(fullPath);
    }
  }

  return results;
}
