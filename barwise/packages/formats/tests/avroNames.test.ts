/**
 * Avro's namespace rule (avro-namespace-from-file-name.spec.md,
 * barwise-1c2): the editor derives a namespace from a file name with
 * toAvroNamespace, and tells the user when that repaired it.
 */
import { describe, expect, it } from "vitest";
import { isAvroNamespace, toAvroNamespace } from "../src/avro/avroNames.js";

describe("Avro namespaces", () => {
  it("accepts dot-separated names that start with a letter or underscore, and the null namespace", () => {
    expect(["com.school", "com._2024", "a.b_c.D9", ""].map(isAvroNamespace)).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("rejects a hyphen, a leading digit and an empty part", () => {
    expect(["com.order-system", "com.2024model", "com..x"].map(isAvroNamespace)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("leaves a valid namespace unchanged, so a registered full name stays", () => {
    expect(toAvroNamespace("com.school")).toBe("com.school");
  });

  it("makes each invalid part valid", () => {
    expect(toAvroNamespace("com.order-system")).toBe("com.order_system");
    expect(toAvroNamespace("com.2024model")).toBe("com._2024model");
    expect(toAvroNamespace("com.my model.v2")).toBe("com.my_model.v2");
    expect(toAvroNamespace("com..x")).toBe("com._.x");
  });

  it("always builds a namespace the rule accepts", () => {
    // Every string of up to three characters over an alphabet holding each
    // class the rule distinguishes: letter, digit, underscore, dot, hyphen,
    // space, a non-ASCII letter and an astral character.
    const alphabet = ["a", "Z", "7", "_", ".", "-", " ", "é", "😀"];
    let level = [""];
    const texts = [""];
    for (let length = 1; length <= 3; length++) {
      level = level.flatMap((prefix) => alphabet.map((ch) => prefix + ch));
      texts.push(...level);
    }
    for (const text of texts) expect(isAvroNamespace(toAvroNamespace(text)), text).toBe(true);
  });
});
