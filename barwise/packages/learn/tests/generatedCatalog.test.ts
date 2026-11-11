/**
 * The compiled-in gym catalog must equal packages/learn/exercises/
 * (barwise-fbi; surface-mirroring spec, workstream 4).
 *
 * `exercises.generated.ts` is committed, so nothing else forces it to
 * stay in step with the files it came from -- the same guard llm's
 * builtins test keeps over `builtins.generated.ts`. Regenerate with
 * `node scripts/regen-gym-exercises.mjs` from barwise/ and review the diff.
 */
import { OrmYamlSerializer } from "@barwise/core";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listExercises } from "../src/exercise/catalog.js";
import { packagedExerciseFiles } from "../src/exercise/exercises.generated.js";

const exercisesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../exercises");
const onDisk = Object.fromEntries(
  readdirSync(exercisesDir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((f) => [f, readFileSync(resolve(exercisesDir, f), "utf8")]),
);

describe("packagedExerciseFiles", () => {
  it("matches packages/learn/exercises/ file for file, byte for byte", () => {
    expect(packagedExerciseFiles).toEqual(onDisk);
    expect(Object.keys(packagedExerciseFiles).length).toBeGreaterThan(0);
  });

  it("loads the same exercises compiled in as from the directory", () => {
    // Models compare through their serialization: two loads of one file
    // build distinct OrmModel instances whose internals need not be equal.
    const serializer = new OrmYamlSerializer();
    const strip = (entries: ReturnType<typeof listExercises>) =>
      entries.map(({ loaded }) => ({
        exercise: loaded.exercise,
        reference: loaded.reference && serializer.serialize(loaded.reference),
        starter: loaded.starter && serializer.serialize(loaded.starter),
      }));
    expect(strip(listExercises())).toEqual(strip(listExercises(exercisesDir)));
  });

  it("gives no file path for a packaged entry, and an absolute one for a directory entry", () => {
    expect(listExercises().every((e) => e.filePath === undefined)).toBe(true);
    expect(listExercises(exercisesDir).every((e) => e.filePath?.startsWith(exercisesDir))).toBe(
      true,
    );
  });
});
