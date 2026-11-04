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
 * What IS testable here is the runtime behaviour every export depends on:
 * an id NORMA accepts, one per model id.
 */
import { derivedId } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { asNormaId, derivedNormaId, NORMA_EXPORT_ID_TAG, toNormaId } from "../src/norma/normaId.js";

describe("toNormaId", () => {
  // NORMA types ids xs:ID (ORM2Core.xsd), so an NCName: a letter or "_",
  // then letters, digits, ".", "-" and "_". A local name can hold more.
  const NCNAME = /^[A-Za-z_][\w.-]*$/;

  it("derives an NCName from any local name, whatever it holds (decision 12(a))", () => {
    for (
      const id of ["ot1", "Order_Line", "The_values_are%3A_%7B1%7D", "crm:Lead", "Ünïcode", ""]
    ) {
      expect(toNormaId(id)).toMatch(NCNAME);
    }
  });

  it("gives one id one NORMA id, and two ids two", () => {
    expect(toNormaId("Person")).toBe(toNormaId("Person"));
    expect(toNormaId("Person")).not.toBe(toNormaId("Person_2"));
  });

  it("is pinned to its tag: editing it changes every export", () => {
    expect(NORMA_EXPORT_ID_TAG).toBe("barwise.norma-export");
    expect(toNormaId("Person")).toBe(`_${derivedId(NORMA_EXPORT_ID_TAG, ["Person"])}`);
  });

  it("passes no id through, not even one that starts with an underscore", () => {
    // A local name such as `_internal` is a local name, not a NORMA id.
    expect(toNormaId("_internal")).not.toBe("_internal");
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
  it("appends a suffix to an existing NORMA id, without re-prefixing", () => {
    expect(derivedNormaId(asNormaId("_ft1"), "_ro0")).toBe("_ft1_ro0");
  });

  it("composes, which is how nested ids like _ft1_idfact_r0 are built", () => {
    const fact = derivedNormaId(asNormaId("_ot1"), "_idfact");
    expect(derivedNormaId(fact, "_r0")).toBe("_ot1_idfact_r0");
  });
});
