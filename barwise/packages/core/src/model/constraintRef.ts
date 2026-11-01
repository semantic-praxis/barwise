import { canonicalJson, derivedId } from "../serialization/derivedId.js";
import { type Constraint, roleIdsOf, subtypeFactIdsOf } from "./Constraint.js";

/**
 * How a constraint is referred to where a string is needed -- a
 * diagnostic's element, a lineage entry: its id, or for one the model left
 * unnamed because its sentence cannot be minted (decision 19) a fixed
 * reference built from its kind, what it constrains, and a short hash of
 * all it states, so two unnamed constraints over one pair -- an irreflexive
 * and an asymmetric ring -- are told apart, as `subtypeFactRef` does for a
 * subtype fact. No 4.0 id can take that form: a local name holds no `<`.
 */
export function constraintRef(c: Constraint): string {
  if (c.id !== undefined) return c.id;
  const over = [...roleIdsOf(c), ...subtypeFactIdsOf(c)].join(",");
  const content = derivedId("constraint.ref", [canonicalJson(c)]).slice(0, 8);
  return `unnamed:${c.type}<${over}>#${content}`;
}
