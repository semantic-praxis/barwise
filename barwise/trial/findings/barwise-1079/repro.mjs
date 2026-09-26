// barwise-1079: not_expressible cannot name a check that has no `element`.
// Run from barwise/: node trial/findings/barwise-1079/repro.mjs
import { personaProblems } from "../../lib/personas.mjs";

const customer = {
  id: "C07",
  personas: [{
    id: "catalog-product-manager",
    judges: ["tmf-openapi"],
    not_expressible: [{
      artifact_kind: "openapi",
      // A requires_verbalization check: OpenAPI has no unique keyword, so
      // "Each RatePlanCode rates at most one ProductOffering" is a format
      // limit -- but the check has no element to name it by.
      check: { sentence: "Each RatePlanCode rates at most one ProductOffering." },
      reason: "OpenAPI has no single-property unique keyword.",
    }],
  }],
  artifacts: [{ id: "tmf-openapi", generator: "openapi" }],
};
const rubric = [
  {
    kind: "requires_verbalization",
    sentence: "Each RatePlanCode rates at most one ProductOffering.",
  },
];
console.log(personaProblems(customer, () => rubric));
// Observed: [ '...: not_expressible[0] matches 0 rubric checks; it must name exactly one' ]
