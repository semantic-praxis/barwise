/**
 * S3 on the spike (docs/specs/effect-adoption.spec.md): the Schema-derived
 * constraint type is the frozen record, kind by kind, with no extra kind.
 */
import { describe, expectTypeOf, it } from "vitest";
import type { ConstraintFromSchema } from "../../src/model/constraintSchema.js";
import type { AllKindsMatch, KindsMatch } from "./constraintRecord.js";

describe("the Schema-derived Constraint", () => {
  it("matches ConstraintRecord kind by kind", () => {
    expectTypeOf<KindsMatch<ConstraintFromSchema>>().toEqualTypeOf<AllKindsMatch>();
  });
});
