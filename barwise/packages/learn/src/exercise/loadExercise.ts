/**
 * Load a `.gym.yaml` exercise from disk, resolving its reference and
 * starter model paths (relative to the exercise file) into `OrmModel`s.
 * This is the one module in the package that touches the filesystem; the
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

function loadModel(baseDir: string, relPath: string): OrmModel {
  const full = resolve(baseDir, relPath);
  return serializer.deserialize(readFileSync(full, "utf-8"));
}

export function loadExercise(filePath: string): LoadedExercise {
  const raw = readFileSync(filePath, "utf-8");
  const exercise = parseExercise(parseYaml(raw));
  const baseDir = dirname(filePath);

  return {
    exercise,
    reference: exercise.reference ? loadModel(baseDir, exercise.reference) : undefined,
    starter: exercise.starter ? loadModel(baseDir, exercise.starter) : undefined,
  };
}
