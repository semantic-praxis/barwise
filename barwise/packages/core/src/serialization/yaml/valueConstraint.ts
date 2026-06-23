import type { ValueRange } from "../../model/ObjectType.js";

export interface OrmYamlValueRange {
  min?: string;
  max?: string;
  min_inclusive?: boolean;
  max_inclusive?: boolean;
}

export interface OrmYamlValueConstraintBody {
  values?: string[];
  ranges?: OrmYamlValueRange[];
}

/** Serialize model value ranges to the YAML shape, omitting default bounds. */
export function serializeValueRanges(
  ranges: readonly ValueRange[],
): OrmYamlValueRange[] {
  return ranges.map((r) => {
    const out: OrmYamlValueRange = {};
    if (r.min !== undefined) out.min = r.min;
    if (r.max !== undefined) out.max = r.max;
    if (r.minInclusive === false) out.min_inclusive = false;
    if (r.maxInclusive === false) out.max_inclusive = false;
    return out;
  });
}

/** Parse YAML value ranges back to the model shape. */
export function deserializeValueRanges(
  ranges: readonly OrmYamlValueRange[],
): ValueRange[] {
  return ranges.map((r) => {
    const out: {
      min?: string;
      max?: string;
      minInclusive?: boolean;
      maxInclusive?: boolean;
    } = {};
    if (r.min !== undefined) out.min = r.min;
    if (r.max !== undefined) out.max = r.max;
    if (r.min_inclusive === false) out.minInclusive = false;
    if (r.max_inclusive === false) out.maxInclusive = false;
    return out;
  });
}

/** Build the YAML value-constraint body, omitting empty values/ranges. */
export function serializeValueConstraintBody(
  values: readonly string[],
  ranges: readonly ValueRange[] | undefined,
): OrmYamlValueConstraintBody {
  const body: OrmYamlValueConstraintBody = {};
  if (values.length > 0) body.values = [...values];
  if (ranges && ranges.length > 0) body.ranges = serializeValueRanges(ranges);
  return body;
}

/** Parse a YAML value-constraint body, defaulting a missing `values` to []. */
export function deserializeValueConstraintBody(
  body: OrmYamlValueConstraintBody,
): { values: string[]; ranges?: ValueRange[]; } {
  const values = body.values ? [...body.values] : [];
  if (body.ranges && body.ranges.length > 0) {
    return { values, ranges: deserializeValueRanges(body.ranges) };
  }
  return { values };
}
