/**
 * The NORMA id space.
 *
 * The brand itself is a compile-time property and cannot be asserted
 * here -- test files are type-checked by nothing in this repo (tsc
 * excludes them, lint is not type-aware, vitest transpiles; barwise-944),
 * so a `@ts-expect-error` in this file would prove nothing. What guards
 * the brand is `tsc` over `src`, watched going red on three planted
 * defects when this landed: a forgotten conversion on an id field, on a
 * `*Ref` field, and a derived id built by template instead of the helper.
 *
 * What IS testable here is the runtime behaviour the round trip depends
 * on, which is why these cases exist rather than being folded into the
 * writer's tests.
 */
import { describe, expect, it } from "vitest";
import { asNormaId, derivedNormaId, toNormaId } from "../src/norma/normaId.js";

describe("toNormaId", () => {
  it("prefixes a model id with NORMA's underscore convention", () => {
    expect(toNormaId("ot1")).toBe("_ot1");
  });

  // The property the round trip rests on. An id that originated in NORMA
  // keeps its token all the way into the model, so exporting it again
  // must not prefix it twice -- NORMA -> model -> NORMA has to be stable.
  it("is idempotent, so a NORMA -> model -> NORMA round trip is stable", () => {
    expect(toNormaId("_ot1")).toBe("_ot1");
    expect(toNormaId(toNormaId("ot1"))).toBe("_ot1");
  });

  it("prefixes an empty id rather than returning it unchanged", () => {
    expect(toNormaId("")).toBe("_");
  });

  it("does not collapse an id that is only underscores", () => {
    expect(toNormaId("__")).toBe("__");
  });
});

describe("asNormaId", () => {
  // Deliberately not toNormaId: this asserts provenance for a token read
  // from a NORMA document, so it must record what the file said. NORMA
  // permits an id without the prefix, and transforming one here would
  // make the parser disagree with its own input.
  it("records the token verbatim, prefix or not", () => {
    expect(asNormaId("_ot1")).toBe("_ot1");
    expect(asNormaId("ot1")).toBe("ot1");
    expect(asNormaId("")).toBe("");
  });
});

describe("derivedNormaId", () => {
  it("appends a suffix to an existing NORMA id", () => {
    expect(derivedNormaId(toNormaId("ft1"), "_ro0")).toBe("_ft1_ro0");
  });

  it("does not re-prefix, because the base is already in NORMA space", () => {
    expect(derivedNormaId(toNormaId("_ft1"), "_r0")).toBe("_ft1_r0");
  });

  it("composes, which is how nested ids like _ft1_idfact_r0 are built", () => {
    const fact = derivedNormaId(toNormaId("ot1"), "_idfact");
    expect(derivedNormaId(fact, "_r0")).toBe("_ot1_idfact_r0");
  });
});
