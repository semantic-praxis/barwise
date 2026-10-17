/**
 * The loader keeps every schema error the decoder did not report, on a
 * constraint the decoder refused. Here the decoder is wrapped so it forgets
 * one rule -- its report on `role` -- which is what a decoder that has
 * drifted from the schema looks like. The schema's report of that rule must
 * still reach the reader, and the 50-odd errors from the other `oneOf`
 * branches must not.
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { describe, expect, it, vi } from "vitest";
import type * as Decoder from "../../src/model/constraintDecoder.js";
import {
  DeserializationError,
  OrmYamlSerializer,
} from "../../src/serialization/OrmYamlSerializer.js";
import type { SchemaError } from "../../src/serialization/SchemaValidator.js";

/** The fields whose problems the wrapped decoder forgets. */
const FORGOTTEN = new Set(["role", "ranges"]);

vi.mock("../../src/model/constraintDecoder.js", async (importOriginal) => {
  const real = await importOriginal<typeof Decoder>();
  return {
    ...real,
    decodeConstraints: (...args: Parameters<typeof real.decodeConstraints>) =>
      Effect.map(
        real.decodeConstraints(...args),
        (results) =>
          results.map((r) =>
            Result.isFailure(r)
              ? Result.fail({
                ...r.failure,
                problems: r.failure.problems.filter((p) => !FORGOTTEN.has(String(p.path[0]))),
              })
              : r
          ),
      ),
  };
});

const YAML = `orm_version: "2.0"
model:
  name: Drift
  object_types:
    - {id: ot-p, name: Person, kind: entity, reference_mode: id}
  fact_types:
    - id: ft-1
      name: Person exists
      roles: [{id: r-1, player: ot-p, role_name: exists}]
      readings: ["{0} exists"]
      constraints:
        - {id: c-1, type: mandatory, role: "", weight: 3}
        - {id: c-2, type: mandatory, weight: 3}
        - {id: c-3, type: mandatory, role: ""}
        - {id: c-4, type: frequency, min: 1, max: 2}
        - {id: c-5, type: value_constraint, role: r-1, ranges: [{}]}
`;

describe("a rule the decoder does not report", () => {
  it("is checked without printing anything", async () => {
    // ajv's strict mode logs to the console when it compiles a branch it
    // reads as untyped; a load must not write to the user's terminal. The
    // validators are cached per module, so a fresh module is loaded here,
    // whatever ran before, and the spies are in place for its first compile.
    vi.resetModules();
    const fresh = await import("../../src/serialization/OrmYamlSerializer.js");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(() => new fresh.OrmYamlSerializer().deserialize(YAML)).toThrow();
      expect(warn).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });

  it("is kept from the constraint's own schema branch, and nothing else is", () => {
    let errors: readonly SchemaError[] = [];
    try {
      new OrmYamlSerializer().deserialize(YAML);
    } catch (e) {
      errors = (e as DeserializationError).validationResult!.errors;
    }
    expect(errors.map((e) => e.path).sort()).toEqual([
      "/model/fact_types/0/constraints/0/role",
      "/model/fact_types/0/constraints/0/weight",
      "/model/fact_types/0/constraints/1",
      "/model/fact_types/0/constraints/1/weight",
      // c-3's only problem is the one the wrapped decoder forgets, so its
      // refusal carries no problems at all; the schema's report still comes.
      "/model/fact_types/0/constraints/2/role",
      "/model/fact_types/0/constraints/3",
      "/model/fact_types/0/constraints/4/ranges/0",
    ]);
    // Kept with the rule the whole-document check gives, worded as the
    // decoder words its own: the constraint, then the field at fault.
    expect(errors.find((e) => e.path.endsWith("/0/role"))).toEqual({
      path: "/model/fact_types/0/constraints/0/role",
      message:
        'Constraint "c-1" in Fact type "Person exists" has an invalid role: must NOT have fewer than 1 characters.',
      rule: { keyword: "minLength" },
    });
    // A "one of these keys" rule is one line, not one "required" per key.
    expect(errors.find((e) => e.path.endsWith("/constraints/3"))).toEqual({
      path: "/model/fact_types/0/constraints/3",
      message: 'Constraint "c-4" in Fact type "Person exists" is missing "role" or "roles".',
      rule: { keyword: "anyOf", missingOneOf: ["role", "roles"] },
    });
    expect(errors.find((e) => e.path.endsWith("/constraints/1"))).toEqual({
      path: "/model/fact_types/0/constraints/1",
      message: 'Constraint "c-2" in Fact type "Person exists" is missing "role".',
      rule: { keyword: "required", missingProperty: "role" },
    });
  });
});

describe("one rule, one sentence, whichever side reports it", () => {
  it("words a range with neither bound in the loader as the decoder does", async () => {
    const real = await vi.importActual<typeof Decoder>("../../src/model/constraintDecoder.js");
    const doc = { id: "c-5", type: "value_constraint", role: "r-1", ranges: [{}] };
    const [result] = Effect.runSync(
      real.decodeConstraints([doc], 'Fact type "Person exists"', () => "x"),
    );
    if (result === undefined || !Result.isFailure(result)) throw new Error("expected a failure");
    const fromDecoder = result.failure.problems.find((p) => p.path.join("/") === "ranges/0");

    let errors: readonly SchemaError[] = [];
    try {
      new OrmYamlSerializer().deserialize(YAML);
    } catch (e) {
      errors = (e as DeserializationError).validationResult!.errors;
    }
    // c-5 is the fifth constraint; the wrapped decoder forgot its range, so
    // this one came from the schema re-check. Same input, same sentence.
    const fromLoader = errors.find((e) => e.path.endsWith("/constraints/4/ranges/0"));
    expect(fromDecoder?.message).toBeDefined();
    expect(fromLoader?.message).toBe(fromDecoder?.message);
  });
});
