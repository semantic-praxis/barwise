/**
 * Exercise catalog discovery: list and load the `.gym.yaml` exercises
 * in a directory. The packaged seed catalog under
 * `packages/learn/exercises/` is the default; surfaces may point at an
 * external catalog directory instead. Filesystem access lives here at
 * the package edge, like `loadExercise`.
 */
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type LoadedExercise, loadExercise } from "./loadExercise.js";

/**
 * The packaged seed catalog. Resolves relative to this module, whose
 * directory sits two levels below the package root in both `src/`
 * (tests) and `dist/` (builds).
 */
export function defaultCatalogDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../exercises");
}

/** An exercise available in a catalog directory. */
export interface CatalogEntry {
  readonly filePath: string;
  readonly loaded: LoadedExercise;
}

/** Load every `.gym.yaml` in the directory, sorted by file name. */
export function listExercises(dir: string = defaultCatalogDir()): CatalogEntry[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".gym.yaml"))
    .sort()
    .map((f) => {
      const filePath = resolve(dir, f);
      return { filePath, loaded: loadExercise(filePath) };
    });
}

/** Find one exercise by its declared id. */
export function findExercise(id: string, dir?: string): CatalogEntry | undefined {
  return listExercises(dir).find((e) => e.loaded.exercise.id === id);
}
