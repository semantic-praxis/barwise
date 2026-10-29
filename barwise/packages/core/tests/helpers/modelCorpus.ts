/**
 * Every tracked model `main`'s reader loads, as the 3.0 document its writer
 * makes of it: the corpus the Effect decoders are held to before they are on
 * the load path (docs/specs/effect-adoption.spec.md, 1r).
 *
 * Asked of git, not the file tree: a checkout holds untracked trial outputs
 * CI never sees. Admitted by the reader itself, with no path filter, so a
 * file is in the corpus exactly when today's loader accepts it; the
 * deliberately malformed fixtures are out because it refuses them, not
 * because their directory is named.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OrmYamlSerializer, writeDocument } from "../../src/serialization/OrmYamlSerializer.js";
import type { OrmYamlDocument } from "../../src/serialization/yaml/document.js";

const ROOT = resolve(import.meta.dirname, "../../../../..");

export interface CorpusModel {
  /** The file's path from the repository root. */
  readonly file: string;
  /** The 3.0 document `main`'s writer makes of the loaded model. */
  readonly doc: OrmYamlDocument;
}

let cached: readonly CorpusModel[] | undefined;

export function modelCorpus(): readonly CorpusModel[] {
  if (cached) return cached;
  const files = execFileSync("git", ["ls-files", "--", "*.orm.yaml"], { cwd: ROOT })
    .toString().trim().split("\n").filter(Boolean);
  const serializer = new OrmYamlSerializer();
  const loaded: CorpusModel[] = [];
  for (const file of files) {
    let model;
    try {
      model = serializer.deserialize(readFileSync(resolve(ROOT, file), "utf8"));
    } catch {
      continue;
    }
    // Through the text, so the document is what a file holds: no field left
    // undefined, as the writer's objects may hold.
    const doc = JSON.parse(JSON.stringify(writeDocument(model))) as OrmYamlDocument;
    loaded.push({ file, doc });
  }
  cached = loaded;
  return loaded;
}
