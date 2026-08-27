/**
 * Exhaustiveness guard for switches over the model's vocabulary
 * unions. TypeScript's implicit check (TS2366) fires only in a
 * value-returning switch with no default; in a void context -- a loop
 * body pushing diagnostics, a statement switch -- an omitted member
 * is silent. `default: assertNever(x)` makes the omission a compile
 * error there too, so adding a union member breaks the build in every
 * place that claims to handle the union exhaustively instead of
 * silently skipping the new member (barwise-869; the audit found a
 * ninth ring type would go unvalidated, undrawn, and coerced with
 * zero build errors).
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled union member: ${JSON.stringify(value)}`);
}
