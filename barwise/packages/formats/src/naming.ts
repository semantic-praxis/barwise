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
