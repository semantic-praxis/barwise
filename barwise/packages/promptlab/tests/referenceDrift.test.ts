/**
 * Drift test (barwise-856): every committed reference model must match
 * a fresh render of its recorded payload.
 *
 * The package's standing rule -- "references are generated, not
 * hand-written... they cannot drift from what the pipeline actually
 * builds" -- was a procedure with nothing enforcing it, and it had
 * drifted: `freight-corrections` was missing a `sample: true` the
 * parser has emitted since the sample-populations work. Nothing failed,
 * because a reference is consumed by `forbids_population`, which asks
 * about constraints and never looks at populations.
 *
 * Regenerate intentionally with `npm run regen:references` and review
 * the diff. A failure here means one of two things, and they call for
 * opposite responses: either the parse path changed and the references
 * should be regenerated, or the parse path regressed and the diff is
 * the bug report.
 *
 * WHAT THIS DOES NOT GUARD, because the natural reading is that it
 * guards the references and it only guards half of that. Both sides of
 * the comparison derive from the same payload, so a payload that
 * degrades takes the reference with it and the two still agree. Tried:
 * replacing a payload with `{"object_types": "not an array"}` renders
 * an empty model -- a reference carrying nothing but a name -- and
 * every test in this file passes.
 *
 * The answer-key invariant in `scoreExtraction.test.ts` is what catches
 * that: an empty reference makes `forbids_population` fail and the
 * pinned 1.000 drops. Three tests fail on that payload, none of them
 * here. The two guards ask different questions -- "does the reference
 * match what the pipeline builds from this payload" versus "does this
 * payload still pass its rubric" -- and only the pair covers the
 * ground. Do not read a green run of this file as the references being
 * sound.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultSuitePath, loadSuite } from "../src/evalcase/loadSuite.js";
import { renderReference } from "../src/evalcase/renderReference.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVALS = resolve(__dirname, "../evals");
const PAYLOADS = resolve(__dirname, "fixtures/responses");

const suite = loadSuite(defaultSuitePath());
const withReference = suite.cases.filter((c) => c.evalCase.reference !== undefined);

describe("committed reference models", () => {
  it("covers every case that has a recorded payload", () => {
    // Guards the guard. If a case gains a payload and no reference, the
    // loop below silently shrinks and this file goes on passing while
    // covering less -- the shape that let the drift survive in the
    // first place.
    const withPayload = suite.cases
      .map((c) => c.evalCase.id)
      .filter((id) => existsSync(join(PAYLOADS, `${id}.json`)));

    expect(withReference.map((c) => c.evalCase.id).sort()).toEqual(withPayload.sort());
  });

  for (const c of withReference) {
    const id = c.evalCase.id;
    it(`${id}.reference.orm.yaml matches a fresh render of its payload`, () => {
      const payload = readFileSync(join(PAYLOADS, `${id}.json`), "utf8");
      const committed = readFileSync(join(EVALS, `${id}.reference.orm.yaml`), "utf8");

      expect(renderReference(payload, id)).toBe(committed);
    });
  }
});

describe("renderReference", () => {
  it("renders the same bytes twice", () => {
    // The property the byte comparison above rests on. It holds with no
    // shim now: every id is one the model gives from a name or a sentence
    // (iri-identity 6b-4b), so one payload renders one file.
    const payload = readFileSync(join(PAYLOADS, "order-management.json"), "utf8");

    expect(renderReference(payload, "order-management"))
      .toBe(renderReference(payload, "order-management"));
  });
});
