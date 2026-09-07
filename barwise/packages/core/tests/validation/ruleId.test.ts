/**
 * What the rule registry has to guarantee, and what the compiler cannot
 * check on its own.
 *
 * The union's completeness is a build-time property: a rule module
 * emitting an identifier absent from the registry does not compile, and
 * `tsc` says so without help from any test. What a type cannot check is
 * whether a descriptor says anything — `description: ""` type-checks
 * perfectly — and whether the registry has drifted the other way, into
 * listing identifiers no rule emits any more. Both are checked here.
 *
 * The second is the one worth explaining. A union that is a superset of
 * what the code emits still compiles and still passes every other test;
 * it just quietly accumulates identifiers for rules that were deleted,
 * which is exactly how a catalogue becomes untrustworthy. So this scans
 * the rule sources and compares both directions.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RULE_IDS, ruleDescriptor } from "../../src/validation/ruleId.js";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

/** Every `ruleId: "..."` literal in core's source. */
function emittedRuleIds(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (entry.endsWith(".ts") && entry !== "ruleId.ts") {
        for (const match of readFileSync(path, "utf8").matchAll(/ruleId: "([^"]+)"/g)) {
          found.add(match[1]!);
        }
      }
    }
  };
  walk(SRC);
  return found;
}

describe("the rule registry", () => {
  it("describes every rule it lists", () => {
    const undescribed = RULE_IDS.filter((id) => {
      const { description } = ruleDescriptor(id);
      return description.trim().length === 0;
    });
    expect(undescribed).toEqual([]);
  });

  it("gives every rule a description that says more than its identifier", () => {
    // A description that merely restates the id in prose ("duplicate
    // fact type name") documents nothing a reader could not already
    // see. Require a real sentence rather than a re-spelling.
    const tooShort = RULE_IDS.filter((id) => ruleDescriptor(id).description.length < 30);
    expect(tooShort).toEqual([]);
  });

  it("lists every identifier the rules actually emit", () => {
    // The compiler already rejects an emitted id that is absent here;
    // this asserts the same thing at runtime so the failure names the
    // id rather than appearing as a type error in an unrelated file.
    const missing = [...emittedRuleIds()].filter((id) => !(RULE_IDS as string[]).includes(id));
    expect(missing).toEqual([]);
  });

  it("lists no identifier the rules have stopped emitting", () => {
    const emitted = emittedRuleIds();
    const stale = RULE_IDS.filter((id) => !emitted.has(id));
    expect(stale).toEqual([]);
  });

  it("found identifiers to check against", () => {
    // Guards the two scans above from passing vacuously if the walk or
    // the pattern ever stops matching.
    expect(emittedRuleIds().size).toBeGreaterThanOrEqual(70);
  });
});
