/**
 * Order two strings by UTF-16 code unit, the order `Array.prototype.sort`
 * uses with no comparator: `-1`, `0` or `1`.
 *
 * Core's sorts go through this rather than `localeCompare`, whose order
 * follows the process locale: `Zebra`, `Ärende`, `Apa`, `aa`, `Ab` sort
 * differently under en-US, sv-SE and da-DK (barwise-c3z). An explicit
 * locale such as `"en"` was rejected too, since its order still depends on
 * the runtime's ICU data, and VS Code runs core in Electron; code-unit order
 * needs none (determinism-in-core, decision 1, `pure-ops`).
 */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
