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
                problems: r.failure.problems.filter((p) => p.path[0] !== "role"),
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
    ]);
    // Kept with the rule the whole-document check gives, worded as the
    // decoder words its own: the constraint, then the field at fault.
    expect(errors.find((e) => e.path.endsWith("/0/role"))).toEqual({
      path: "/model/fact_types/0/constraints/0/role",
      message:
        'Constraint "c-1" in Fact type "Person exists" has an invalid role: must NOT have fewer than 1 characters.',
      rule: { keyword: "minLength" },
    });
    expect(errors.find((e) => e.path.endsWith("/constraints/1"))).toEqual({
      path: "/model/fact_types/0/constraints/1",
      message: 'Constraint "c-2" in Fact type "Person exists" is missing "role".',
      rule: { keyword: "required", missingProperty: "role" },
    });
  });
});
