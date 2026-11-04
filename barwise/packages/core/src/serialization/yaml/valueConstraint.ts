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
