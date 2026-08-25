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

describe("withDeterministicIds", () => {
  it("renders the same bytes twice", async () => {
    // The property the byte comparison above rests on. Without it the
    // drift test would fail on every run for reasons that mean nothing.
    const payload = readFileSync(join(PAYLOADS, "order-management.json"), "utf8");

    expect(renderReference(payload, "order-management"))
      .toBe(renderReference(payload, "order-management"));
  });

  it("restores the ambient id generator afterwards", async () => {
    // `setIdGenerator` is process-wide. A leak would leave every later
    // test in this worker minting fixture ids and still passing, then
    // surface as an inexplicable diff in some unrelated file days
    // later.
    const { generateId } = await import("@barwise/core");
    renderReference(readFileSync(join(PAYLOADS, "order-management.json"), "utf8"), "x");

    expect(generateId()).not.toMatch(/^00000000-0000-7/);
  });
});
