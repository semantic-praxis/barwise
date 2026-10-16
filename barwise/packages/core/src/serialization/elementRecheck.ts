/**
 * Re-checking one element the decoder refused against its own part of the
 * JSON Schema, and keeping what the decoder did not report.
 *
 * The loader drops the whole-document check's errors on a refused element
 * (for a constraint, one per `oneOf` branch it failed) and asks this instead,
 * so a rule only the schema states still reaches the reader, without the
 * noise. Shared by constraints and fact types.
 */
import type { ErrorObject, ValidateFunction } from "ajv";
import { pointerSegment } from "./jsonPointer.js";

/**
 * The errors `validate` finds in `raw` that the decoder did not report.
 *
 * Covered means reported at the same place: at the error's own path; for a
 * missing or unknown key, at that key; and for a "one of these keys" rule,
 * at the place itself or at any of its keys. (Its anyOf error's own
 * `schemaPath` ends in `/anyOf`, its members' in `/anyOf/<n>/required`;
 * both are cut at the last `/anyOf` to group them.)
 *
 * @param reported Where the decoder reported, as JSON Pointers below the element.
 */
export function unreportedErrors(
  validate: ValidateFunction,
  raw: unknown,
  reported: ReadonlySet<string>,
): ErrorObject[] {
  if (validate(raw)) return [];
  const errors = validate.errors ?? [];
  const at = reported;
  // An anyOf's keys, by the place and schema path of the anyOf.
  const groupOf = (e: ErrorObject) => {
    const cut = e.schemaPath.lastIndexOf("/anyOf");
    return cut < 0 ? undefined : `${e.instancePath}|${e.schemaPath.slice(0, cut)}`;
  };
  const groupKeys = new Map<string, string[]>();
  for (const e of errors) {
    const group = groupOf(e);
    const missing = (e.params as { missingProperty?: string; }).missingProperty;
    if (group !== undefined && missing !== undefined) {
      groupKeys.set(group, [...(groupKeys.get(group) ?? []), missing]);
    }
  }
  const covered = (e: ErrorObject) => {
    const params = e.params as { missingProperty?: string; additionalProperty?: string; };
    const group = groupOf(e);
    if (group !== undefined) {
      return at.has(e.instancePath)
        || (groupKeys.get(group) ?? []).some((k) =>
          at.has(`${e.instancePath}/${pointerSegment(k)}`)
        );
    }
    if (params.missingProperty !== undefined) {
      return at.has(`${e.instancePath}/${pointerSegment(params.missingProperty)}`);
    }
    if (params.additionalProperty !== undefined) {
      return at.has(`${e.instancePath}/${pointerSegment(params.additionalProperty)}`);
    }
    return at.has(e.instancePath);
  };
  // An uncovered "one of these keys" group is one rule: kept as its anyOf
  // error carrying the group's keys, not as one "required" per key, which
  // would tell the reader to add every one of them.
  return errors
    .filter((e) => !covered(e))
    .filter((e) => groupOf(e) === undefined || e.keyword !== "required")
    .map((e) => {
      const keys = e.keyword === "anyOf" ? groupKeys.get(groupOf(e)!) : undefined;
      return keys === undefined ? e : { ...e, params: { ...e.params, anyOfKeys: keys } };
    });
}
