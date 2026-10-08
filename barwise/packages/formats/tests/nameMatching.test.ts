import { describe, expect, it } from "vitest";
import { bareName, headNoun, sameUpToNumber } from "../src/ddl/nameMatching.js";

describe("name matching shared by the subtype rule and reference inference", () => {
  it("strips quoting and schema", () => {
    expect(bareName(`"CBS"."PARTY"`)).toBe("party");
    expect(bareName("[PARTY]")).toBe("party");
    expect(bareName("`party`")).toBe("party");
  });

  it("takes the last word as the head noun", () => {
    expect(headNoun("ENROLLED_SUBJECT")).toBe("subject");
    expect(headNoun("SGBSTDN")).toBe("sgbstdn");
    expect(headNoun("PAT_2")).toBe("2");
  });

  it("matches each ending pair in both directions", () => {
    for (const [p, s] of [["categories", "category"], ["statuses", "status"], ["subjects", "subject"]]) {
      expect(sameUpToNumber(p!, s!)).toBe(true);
      expect(sameUpToNumber(s!, p!)).toBe(true);
    }
  });

  it("ignores case", () => {
    expect(sameUpToNumber("SUBJECT", "subject")).toBe(true);
  });

  it("matches an irregular plural only to itself, and no other ending", () => {
    expect(sameUpToNumber("people", "person")).toBe(false);
    expect(sameUpToNumber("people", "people")).toBe(true);
    expect(sameUpToNumber("subjective", "subject")).toBe(false);
    expect(sameUpToNumber("orders", "order")).toBe(true);
    expect(sameUpToNumber("order", "ordering")).toBe(false);
  });
});
