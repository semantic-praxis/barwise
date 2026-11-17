/**
 * The compiled-in eval suite must equal packages/promptlab/evals/
 * (barwise-fke), as learn's generatedCatalog test holds the gym catalog.
 *
 * `suite.generated.json` is committed, so nothing else forces it to stay
 * in step with the files it came from. Regenerate with
 * `node barwise/scripts/regen-eval-suite.mjs` and review the diff.
 */
import { OrmYamlSerializer } from "@barwise/core";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import packagedSuiteFiles from "../src/evalcase/suite.generated.json" with { type: "json" };
import { loadPackagedSuite, loadSuite } from "../src/index.js";

const evalsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../evals");
// Every file under evals/ but the run record: the same rule as the
// generator, which has no filter for this to drift from.
function filesUnder(dir: string, prefix = ""): string[] {
  return readdirSync(dir).sort().flatMap((entry) => {
    const rel = prefix === "" ? entry : `${prefix}/${entry}`;
    return statSync(resolve(dir, entry)).isDirectory()
      ? filesUnder(resolve(dir, entry), rel)
      : [rel];
  });
}
const onDisk = Object.fromEntries(
  filesUnder(evalsDir)
    .filter((f) => f !== "history.jsonl")
    .map((f) => [f, readFileSync(resolve(evalsDir, f), "utf8")]),
);

describe("the compiled-in eval suite", () => {
  it("matches packages/promptlab/evals/ file for file, byte for byte, without history.jsonl", () => {
    expect(packagedSuiteFiles).toEqual(onDisk);
    expect(Object.keys(packagedSuiteFiles)).not.toContain("history.jsonl");
  });

  it("loads the same suite compiled in as from the directory, with no manifest path", () => {
    // Models compare through their serialization: two loads of one file
    // build distinct OrmModel instances whose internals need not be equal.
    const serializer = new OrmYamlSerializer();
    const strip = (suite: ReturnType<typeof loadSuite>) => ({
      version: suite.version,
      weights: suite.weights,
      collapseFloor: suite.collapseFloor,
      cases: suite.cases.map((c) => ({
        evalCase: c.evalCase,
        split: c.split,
        transcript: c.transcript,
        reference: c.reference && serializer.serialize(c.reference),
      })),
    });
    const packaged = loadPackagedSuite();
    const fromDisk = loadSuite(resolve(evalsDir, "suite.yaml"));
    expect(strip(packaged)).toEqual(strip(fromDisk));
    expect(packaged.manifestPath).toBeUndefined();
    expect(fromDisk.manifestPath).toBe(resolve(evalsDir, "suite.yaml"));
  });
});
