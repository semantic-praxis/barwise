/**
 * Naming helpers shared by the format adapters, so one adapter's reason to
 * change a name rule does not reach another through its private module.
 */

/**
 * Convert a PascalCase or camelCase name to snake_case.
 */
export function snakeCase(name: string): string {
  return name
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_");
}

/**
 * A distinct name for each of `names`. A valid one is kept and reserved
 * first, so a repaired name never takes it whatever the order; a repaired
 * name that is taken, by a kept name, an earlier repair or `taken`, gets
 * `_2`, `_3`, and so on.
 */
export function uniqueNames(
  names: readonly string[],
  isValid: (name: string) => boolean,
  repair: (name: string) => string,
  taken: Iterable<string> = [],
): Map<string, string> {
  const result = new Map(names.filter(isValid).map((n) => [n, n]));
  const used = new Set([...taken, ...result.values()]);
  for (const name of names) {
    if (result.has(name)) continue;
    const base = repair(name);
    let unique = base;
    for (let n = 2; used.has(unique); n++) unique = `${base}_${n}`;
    result.set(name, unique);
    used.add(unique);
  }
  return result;
}

/**
 * A snake_case table or column name as a PascalCase record or schema name,
 * the one rule the Avro and OpenAPI renderers and exporters share
 * (format-renderers-to-connectors.spec.md, WS1: four copies became one).
 */
export function toPascalCase(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}
