/**
 * Load a `.tutorial.yaml` from disk, resolving each step's model
 * snapshot (relative to the tutorial file) into an `OrmModel`. The one
 * tutorial module that touches the filesystem; parsing and rendering
 * are pure.
 */
import { OrmYamlSerializer } from "@barwise/core";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseTutorial } from "./parseTutorial.js";
import type { LoadedTutorial } from "./types.js";

const serializer = new OrmYamlSerializer();

export function loadTutorial(filePath: string): LoadedTutorial {
  const raw = readFileSync(filePath, "utf-8");
  const def = parseTutorial(parseYaml(raw));
  const baseDir = dirname(filePath);

  return {
    ...def,
    steps: def.steps.map((step) => ({
      ...step,
      modelInstance: serializer.deserialize(
        readFileSync(resolve(baseDir, step.model), "utf-8"),
      ),
    })),
  };
}
