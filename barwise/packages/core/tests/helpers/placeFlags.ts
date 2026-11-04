/**
 * Place the `isPreferred: true` flags a test fixture sets on its uniqueness
 * constraints, as the 2.0 reader places a file's `is_preferred`
 * (orm-format-3 WS4b). The model no longer has the field: a fixture that
 * states an identifier that way passes its constraints through unchanged,
 * and this stores the reference each flag names. One call after the model
 * is built, and after its objectifications, since an objectified fact
 * type's flag names the objectifying type.
 */
import type { InternalConstraint } from "../../src/model/Constraint.js";
import { storePreferredFlags } from "../../src/model/identification.js";
import type { OrmModel } from "../../src/model/OrmModel.js";

export function placeFlags<M extends OrmModel>(model: M): M {
  storePreferredFlags(
    model,
    (c: InternalConstraint) =>
      (c as InternalConstraint & { isPreferred?: boolean; }).isPreferred === true,
  );
  return model;
}
