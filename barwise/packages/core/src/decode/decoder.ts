/**
 * The one decoder shell every element kind uses
 * (docs/specs/effect-adoption.spec.md, 1r): decode with every problem
 * collected and a file's unknown field refused, turn Effect's issue tree
 * into problems (`problemsOf`), and offer the synchronous boundary a caller
 * outside Effect calls. Written once so the 17 constraint kinds, fact types
 * and the document do not each carry a copy (second review of R1).
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import { type DecodeProblem, problemsOf } from "./problems.js";

/** Every problem one decode found; never empty. */
export class DecodeProblems {
  readonly _tag = "DecodeProblems";
  constructor(readonly problems: readonly [DecodeProblem, ...DecodeProblem[]]) {}
}

/** Thrown at the synchronous boundary, carrying the list as well as the text. */
export class DecodeError extends Error {
  constructor(readonly problems: readonly [DecodeProblem, ...DecodeProblem[]]) {
    super(problems.map((p) => p.message).join("\n"));
    this.name = "DecodeError";
  }
}

/** A file's unknown field is refused, as its JSON Schema refuses it. */
const OPTIONS: SchemaAST.ParseOptions = { errors: "all", onExcessProperty: "error" };

export interface DecodeOptions {
  /** Off only in the harness's own test, to show which cases need it. */
  readonly harness?: boolean;
}

/** A decoder for one Schema: the decoded value, or every problem with it. */
export function decoderFor<S extends Schema.Top>(schema: S) {
  const decode = Schema.decodeUnknownEffect(schema, OPTIONS);
  return (raw: unknown, options: DecodeOptions = {}): Effect.Effect<S["Type"], DecodeProblems> =>
    decode(raw).pipe(
      Effect.mapError((error) => {
        const problems = problemsOf(error.issue, raw, options);
        // A failed decode always carries at least one leaf; the fallback only
        // keeps the type honest if Effect ever hands back an empty composite.
        return new DecodeProblems(
          problems.length > 0
            ? (problems as [DecodeProblem, ...DecodeProblem[]])
            : [{ element: "", path: [], message: "The value is malformed." }],
        );
      }),
    ) as Effect.Effect<S["Type"], DecodeProblems>;
}

/** The synchronous boundary: the value, or every problem thrown at once. */
export function runDecode<A>(decoded: Effect.Effect<A, DecodeProblems>): A {
  const result = Effect.runSync(Effect.result(decoded));
  if (Result.isFailure(result)) throw new DecodeError(result.failure.problems);
  return result.success;
}
