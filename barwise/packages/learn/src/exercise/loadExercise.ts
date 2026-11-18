/**
 * Load a `.gym.yaml` exercise, resolving its reference and starter model
 * paths (relative to the exercise file) into `OrmModel`s. `loadExercise`
 * reads from disk; `loadExerciseFrom` takes the text and a reader for the
 * files beside it, which is how the compiled-in catalog loads. The
 * evaluator itself is pure and takes already-loaded models.
 */
import { type OrmModel, OrmYamlSerializer } from "@barwise/core";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseExercise } from "./parseExercise.js";
import type { GymExercise } from "./types.js";

export interface LoadedExercise {
  readonly exercise: GymExercise;
  /** The resolved reference model, if the exercise declares one. */
  readonly reference?: OrmModel;
  /** The resolved starter model, if the exercise declares one. */
  readonly starter?: OrmModel;
}

const serializer = new OrmYamlSerializer();

/**
 * Load an exercise from its text. `readSibling` returns the text of a
 * file named relative to the exercise, as its `reference` and `starter`
 * fields name them.
 */
export function loadExerciseFrom(
  raw: string,
  readSibling: (relPath: string) => string,
): LoadedExercise {
  const exercise = parseExercise(parseYaml(raw));
  const model = (relPath: string): OrmModel => serializer.deserialize(readSibling(relPath));

  return {
    exercise,
    reference: exercise.reference ? model(exercise.reference) : undefined,
    starter: exercise.starter ? model(exercise.starter) : undefined,
  };
}

export function loadExercise(filePath: string): LoadedExercise {
  const baseDir = dirname(filePath);
  return loadExerciseFrom(
    readFileSync(filePath, "utf-8"),
    (relPath) => readFileSync(resolve(baseDir, relPath), "utf-8"),
  );
}
