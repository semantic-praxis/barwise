/**
 * Where `locate` reports a filter's failure, and in whose words: a filter
 * that points at a field is reported at the field, and one with an authored
 * message keeps it there rather than falling back to Effect's default.
 */
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { locate, predicateOf } from "../../src/model/schemaIssues.js";

const Pair = Schema.Struct({ min: Schema.Number, max: Schema.Number });
const pointing = (message?: string) =>
  Pair.check(
    Schema.makeFilter(
      (p: { readonly min: number; readonly max: number; }) =>
        p.min <= p.max || { path: ["max"], issue: "is below min." },
      message === undefined ? undefined : { message },
    ),
  );

function reported(schema: ReturnType<typeof pointing>) {
  const result = Schema.decodeUnknownResult(schema)({ min: 3, max: 1 });
  if (!Result.isFailure(result)) throw new Error("expected a failure");
  return locate(result.failure.issue).map(({ path, issue }) => ({
    path,
    predicate: predicateOf(issue, path, "root"),
  }));
}

describe("locate on a filter that points at a field", () => {
  it("reports the pointed-at field in the filter's own words", () => {
    expect(reported(pointing())).toEqual([{ path: ["max"], predicate: "is below min." }]);
  });

  it("keeps an authored message, at the field", () => {
    expect(reported(pointing("must have max >= min."))).toEqual([
      { path: ["max"], predicate: "must have max >= min." },
    ]);
  });
});
