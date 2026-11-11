/**
 * Exercise catalog discovery: list and load the `.gym.yaml` exercises
 * in a catalog. The packaged seed catalog is the default and is compiled
 * in (`exercises.generated.ts`, from `packages/learn/exercises/`);
 * surfaces may point at an external catalog directory instead, which is
 * read from disk at the package edge, like `loadExercise`.
 */
import { readdirSync } from "node:fs";
import { posix, resolve } from "node:path";
import { packagedExerciseFiles } from "./exercises.generated.js";
import { type LoadedExercise, loadExercise, loadExerciseFrom } from "./loadExercise.js";

/** An exercise available in a catalog. */
export interface CatalogEntry {
  /**
   * The exercise file on disk. Absent for the packaged catalog, which is
   * compiled in: the release bundles are single files with no catalog
   * directory beside them (barwise-fbi).
   */
  readonly filePath?: string;
  readonly loaded: LoadedExercise;
}

const isExercise = (name: string): boolean => name.endsWith(".gym.yaml");

/** A packaged catalog file by its path relative to the catalog root. */
function packagedFile(relPath: string): string {
  const text = packagedExerciseFiles[posix.normalize(relPath)];
  if (text === undefined) {
    throw new Error(`The packaged exercise catalog has no file "${relPath}".`);
  }
  return text;
}

function listPackaged(): CatalogEntry[] {
  return Object.keys(packagedExerciseFiles)
    .filter(isExercise)
    .sort()
    .map((name) => ({ loaded: loadExerciseFrom(packagedFile(name), packagedFile) }));
}

/**
 * Load every `.gym.yaml` in the directory, sorted by file name; with no
 * directory, the packaged catalog.
 */
export function listExercises(dir?: string): CatalogEntry[] {
  if (dir === undefined) return listPackaged();
  return readdirSync(dir)
    .filter(isExercise)
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
