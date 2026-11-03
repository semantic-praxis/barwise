/**
 * Reference models, rendered from the recorded payloads (barwise-856).
 *
 * The package has carried this as a standing rule since the suite was
 * built -- references are generated, never hand-written, by running a
 * recorded payload through the production parse path -- and until now
 * nothing implemented it. A rule with no implementation is a procedure,
 * so the guarantee that a reference cannot drift from what the pipeline
 * builds rested on whoever last did it by hand.
 *
 * It had drifted. The first run of the regenerator found
 * `freight-corrections` missing a `sample: true` that the parser has
 * been emitting since the sample-populations work.
 *
 * This lives in `src` rather than in the regen script because the drift
 * test and the script must render identically. Two copies of this that
 * disagree would give a passing drift test over a file the script
 * writes differently -- the failure mode the test exists to prevent,
 * one level up.
 */
import { OrmYamlSerializer } from "@barwise/core";
import { parseExtractionFromJson } from "@barwise/llm";

/**
 * A recorded extraction payload, rendered as the `.orm.yaml` a
 * reference model is.
 *
 * Deliberately the same `parseExtractionFromJson` the pipeline runs,
 * conformance and all: a reference produced by any other path would be
 * a claim about what the pipeline builds rather than an observation of
 * it, which is the whole reason references are generated.
 */
export function renderReference(payloadJson: string, modelName: string): string {
  // Byte-comparable without a shim: every id is a local name the model
  // gives from its element's name (iri-identity 6b-4b), so one payload
  // renders one file. `withDeterministicIds` existed only while ids were
  // random, and retired with the generator.
  const result = parseExtractionFromJson(payloadJson, modelName);
  return new OrmYamlSerializer().serialize(result.model);
}
