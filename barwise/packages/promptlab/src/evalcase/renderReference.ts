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
import { OrmYamlSerializer, setIdGenerator, uuidv7FromParts } from "@barwise/core";
import { parseExtractionFromJson } from "@barwise/llm";

/**
 * Run `fn` with element ids minted deterministically, then restore
 * whatever generator was installed before.
 *
 * Ids are minted fresh on every parse, so without this a regeneration
 * rewrites every id and a drift test can only ever compare structure.
 * Fixing them makes the whole file byte-comparable.
 *
 * The restore is not optional and the `finally` is the point:
 * `setIdGenerator` is process-wide, so a test that installs one and
 * throws would leave every later test in the same worker minting
 * fixture ids -- and they would still pass, because ids are matched by
 * nothing. It would surface as a mysterious diff in some unrelated
 * regenerated file, days later.
 *
 * The timestamp is 0 on purpose: ids come out as
 * `00000000-0000-7001-...` and read at a glance as generated fixtures
 * rather than as anything minted by a real run.
 */
export function withDeterministicIds<T>(fn: () => T): T {
  // Exported for its own test, not from the package barrel:
  // `renderReference` is the only caller, and a second public name with
  // no consumer is the defect the audit that produced this file was
  // about (barwise-856's own PR shipped it that way for one commit).
  let n = 0;
  setIdGenerator(() => {
    n += 1;
    const r = new Uint8Array(10);
    r[0] = (n >> 8) & 0x0f;
    r[1] = n & 0xff;
    for (let i = 2; i < 10; i++) r[i] = (n * 31 + i * 7) & 0xff;
    return uuidv7FromParts(0, r);
  });
  try {
    return fn();
  } finally {
    setIdGenerator(undefined);
  }
}

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
  return withDeterministicIds(() => {
    const result = parseExtractionFromJson(payloadJson, modelName);
    return new OrmYamlSerializer().serialize(result.model);
  });
}
