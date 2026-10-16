/**
 * The repository's own model files, as the S1 corpus tests read them: every
 * tracked `.orm.yaml` that main's rules accept -- migrated to the current
 * version, then valid against the JSON Schema -- with the S4 malformed
 * fixtures left out.
 *
 * Not "files `OrmYamlSerializer` loads": on the spike that loader runs the
 * Effect decoders, so a file a decoder wrongly refused would drop out of the
 * corpus instead of failing the comparison, and S1 could not see its own
 * regression. Tracked, not walked: a walk of the disk raced the CLI tests'
 * scratch directories under turbo, and read whatever a working tree held.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { SchemaValidator } from "../../src/serialization/SchemaValidator.js";
import {
  applyMigrations,
  CURRENT_ORM_VERSION,
  planMigration,
} from "../../src/serialization/schemaVersion.js";

export interface CorpusDocument {
  readonly file: string;
  readonly doc: Record<string, unknown>;
}

const ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

function migrated(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const doc = raw as Record<string, unknown>;
  const version = doc.orm_version;
  if (typeof version !== "string" || version === CURRENT_ORM_VERSION) return doc;
  const plan = planMigration(version);
  return plan.ok ? applyMigrations(doc, plan.steps) : undefined;
}

export function corpusDocuments(): readonly CorpusDocument[] {
  const validator = new SchemaValidator();
  return execFileSync("git", ["-C", ROOT, "ls-files", "-z", "--", "*.orm.yaml"], {
    encoding: "utf8",
  })
    .split("\0")
    .filter((f) => f !== "" && !f.includes("/fixtures/malformed/"))
    .flatMap((f) => {
      const file = join(ROOT, f);
      let doc: Record<string, unknown> | undefined;
      try {
        doc = migrated(parse(readFileSync(file, "utf8")));
      } catch {
        return [];
      }
      return doc !== undefined && validator.validateModel(doc).valid ? [{ file, doc }] : [];
    });
}
