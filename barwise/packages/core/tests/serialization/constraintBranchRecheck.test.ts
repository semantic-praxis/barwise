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
              ? Result.fail(r.failure.filter((p) => p.path[0] !== "role"))
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
`;

describe("a rule the decoder does not report", () => {
  it("is kept from the constraint's own schema branch, and nothing else is", () => {
    let errors: readonly { path: string; message: string; }[] = [];
    try {
      new OrmYamlSerializer().deserialize(YAML);
    } catch (e) {
      errors = (e as DeserializationError).validationResult!.errors;
    }
    expect(errors.map((e) => e.path).sort()).toEqual([
      "/model/fact_types/0/constraints/0/role",
      "/model/fact_types/0/constraints/0/weight",
    ]);
    expect(errors.find((e) => e.path.endsWith("/role"))!.message).toBe(
      'Constraint "c-1" in Fact type "Person exists" must NOT have fewer than 1 characters.',
    );
  });
});
